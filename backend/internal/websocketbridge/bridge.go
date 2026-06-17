package websocketbridge

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/coder/websocket"

	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
)

const (
	frameTypeAck     = "ack"
	frameTypeMessage = "message"
	frameTypePing    = "ping"
	frameTypePong    = "pong"

	outboundQueueSize = 1024
	writeTimeout      = 5 * time.Second
	keepaliveInterval = 1 * time.Second
	readTimeout       = 10 * time.Second
	dedupWindow       = 10 * time.Minute
	readLimitBytes    = 1024 * 1024
	activeLogInterval = time.Minute
)

type Bridge struct {
	activeConnections atomic.Int64
	authCookieName    string
	bus               *eventbus.Bus
	connection        uint64
	logger            logging.Logger
	stopActiveLog     chan struct{}
	stopActiveLogOnce sync.Once
}

type frame struct {
	Type     string             `json:"type"`
	Seq      uint64             `json:"seq,omitempty"`
	Ack      uint64             `json:"ack,omitempty"`
	Envelope *eventbus.Envelope `json:"envelope,omitempty"`
}

type connection struct {
	bridge      *Bridge
	conn        *websocket.Conn
	name        string
	remoteAddr  string
	outbound    chan eventbus.Envelope
	ackOutbound chan uint64
	ackReceived chan uint64
	authToken   string
	deduper     *messageDeduper
}

func New(bus *eventbus.Bus, logger logging.Logger, authCookieName string) *Bridge {
	return &Bridge{
		authCookieName: authCookieName,
		bus:            bus,
		logger:         logger,
		stopActiveLog:  make(chan struct{}),
	}
}

func (bridge *Bridge) StartActiveConnectionLogging(ctx context.Context) {
	ticker := time.NewTicker(activeLogInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-bridge.stopActiveLog:
			return
		case <-ticker.C:
			bridge.logActiveConnections(context.Background())
		}
	}
}

func (bridge *Bridge) StopActiveConnectionLogging() {
	bridge.stopActiveLogOnce.Do(func() {
		close(bridge.stopActiveLog)
	})
}

func (bridge *Bridge) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	socket, err := websocket.Accept(response, request, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		bridge.logger.Warn(
			request.Context(),
			"websocket accept failed",
			logging.Error(err),
		)
		return
	}
	socket.SetReadLimit(readLimitBytes)

	authToken := ""
	if bridge.authCookieName != "" {
		if cookie, err := request.Cookie(bridge.authCookieName); err == nil {
			authToken = cookie.Value
		}
	}

	connectionID := atomic.AddUint64(&bridge.connection, 1)
	connection := &connection{
		bridge:      bridge,
		conn:        socket,
		name:        makeConnectionName(request.RemoteAddr, connectionID),
		remoteAddr:  request.RemoteAddr,
		outbound:    make(chan eventbus.Envelope, outboundQueueSize),
		ackOutbound: make(chan uint64, 16),
		ackReceived: make(chan uint64, 16),
		authToken:   authToken,
		deduper:     newMessageDeduper(dedupWindow),
	}

	connection.run(request.Context())
}

func (connection *connection) run(parentCtx context.Context) {
	ctx, cancel := context.WithCancel(parentCtx)
	defer cancel()
	defer connection.conn.Close(websocket.StatusNormalClosure, "closed")

	activeCount := connection.bridge.activeConnections.Add(1)
	connection.bridge.logger.Info(
		ctx,
		"websocket connection opened",
		logging.String("connection", connection.name),
		logging.String("remoteAddr", connection.remoteAddr),
		logging.Int64("activeConnections", activeCount),
	)
	defer func() {
		activeCount := connection.bridge.activeConnections.Add(-1)
		connection.bridge.logger.Info(
			context.Background(),
			"websocket connection closed",
			logging.String("connection", connection.name),
			logging.String("remoteAddr", connection.remoteAddr),
			logging.Int64("activeConnections", activeCount),
		)
	}()

	unlisten := connection.bridge.bus.Listen(connection.name+".*", func(_ context.Context, envelope eventbus.Envelope) {
		envelope.AuthToken = ""
		envelope.Destination = strings.TrimPrefix(envelope.Destination, connection.name+".")

		select {
		case connection.outbound <- envelope:
		case <-ctx.Done():
		default:
			connection.bridge.logger.Warn(
				ctx,
				"websocket outbound queue is full",
				logging.String("connection", connection.name),
			)
			cancel()
		}
	})
	defer unlisten()

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)

	go func() {
		defer waitGroup.Done()
		if err := connection.readLoop(ctx); err != nil {
			connection.bridge.logger.Debug(
				ctx,
				"websocket read loop ended",
				logging.String("connection", connection.name),
				logging.Error(err),
			)
		}
		cancel()
	}()

	go func() {
		defer waitGroup.Done()
		if err := connection.writeLoop(ctx); err != nil {
			connection.bridge.logger.Debug(
				ctx,
				"websocket write loop ended",
				logging.String("connection", connection.name),
				logging.Error(err),
			)
		}
		cancel()
	}()

	waitGroup.Wait()
}

func (bridge *Bridge) logActiveConnections(ctx context.Context) {
	bridge.logger.Info(
		ctx,
		"websocket active connection count",
		logging.Int64("activeConnections", bridge.activeConnections.Load()),
	)
}

func (connection *connection) readLoop(ctx context.Context) error {
	for {
		readCtx, cancel := context.WithTimeout(ctx, readTimeout)
		_, data, err := connection.conn.Read(readCtx)
		cancel()

		if err != nil {
			return err
		}

		var incoming frame
		if err := json.Unmarshal(data, &incoming); err != nil {
			connection.bridge.logger.Warn(
				ctx,
				"invalid websocket frame",
				logging.String("connection", connection.name),
				logging.Error(err),
			)
			continue
		}

		if incoming.Ack > 0 {
			select {
			case connection.ackReceived <- incoming.Ack:
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
		}

		switch incoming.Type {
		case frameTypeMessage:
			if incoming.Envelope == nil {
				continue
			}

			connection.receiveEnvelope(ctx, incoming.Seq, *incoming.Envelope)
		case frameTypePing:
			if err := connection.writeFrame(ctx, frame{
				Ack:  incoming.Seq,
				Type: frameTypePong,
			}); err != nil {
				return err
			}
		case frameTypeAck, frameTypePong:
			continue
		default:
			connection.bridge.logger.Warn(
				ctx,
				"unknown websocket frame type",
				logging.String("connection", connection.name),
				logging.String("type", incoming.Type),
			)
		}
	}
}

func (connection *connection) receiveEnvelope(ctx context.Context, seq uint64, envelope eventbus.Envelope) {
	source := connection.name
	if envelope.Source != nil && *envelope.Source != "" {
		source = connection.name + "." + *envelope.Source
	}

	if envelope.ID == "" {
		envelope.ID = eventbus.CreateMessageID()
	}
	if connection.authToken != "" {
		envelope.AuthToken = connection.authToken
	}
	envelope.Source = &source

	if connection.deduper.markSeen(envelope.ID, time.Now()) {
		if err := connection.bridge.bus.Send(ctx, envelope); err != nil {
			connection.bridge.logger.Warn(
				ctx,
				"failed to relay websocket envelope",
				logging.String("connection", connection.name),
				logging.Error(err),
			)
		}
	}

	select {
	case connection.ackOutbound <- seq:
	case <-ctx.Done():
	default:
	}
}

func (connection *connection) writeLoop(ctx context.Context) error {
	keepalive := time.NewTicker(keepaliveInterval)
	defer keepalive.Stop()

	var nextSeq uint64
	unacked := make(map[uint64]frame)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ack := <-connection.ackReceived:
			for seq := range unacked {
				if seq <= ack {
					delete(unacked, seq)
				}
			}
		case ack := <-connection.ackOutbound:
			if err := connection.writeFrame(ctx, frame{
				Ack:  ack,
				Type: frameTypeAck,
			}); err != nil {
				return err
			}
		case envelope := <-connection.outbound:
			nextSeq++
			outgoing := frame{
				Envelope: &envelope,
				Seq:      nextSeq,
				Type:     frameTypeMessage,
			}
			unacked[nextSeq] = outgoing

			if err := connection.writeFrame(ctx, outgoing); err != nil {
				return err
			}
		case <-keepalive.C:
			nextSeq++
			outgoing := frame{
				Seq:  nextSeq,
				Type: frameTypePing,
			}
			unacked[nextSeq] = outgoing

			if err := connection.writeFrame(ctx, outgoing); err != nil {
				return err
			}
		}
	}
}

func (connection *connection) writeFrame(ctx context.Context, outgoing frame) error {
	data, err := json.Marshal(outgoing)
	if err != nil {
		return err
	}

	writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()

	return connection.conn.Write(writeCtx, websocket.MessageText, data)
}

func makeConnectionName(remoteAddr string, connectionID uint64) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}

	ip := net.ParseIP(host)
	if ipv4 := ip.To4(); ipv4 != nil {
		return "ws." + strings.ReplaceAll(ipv4.String(), ".", "_") + "_" + formatUint(connectionID)
	}

	return "ws." + sanitizeEndpointPart(host) + "_" + formatUint(connectionID)
}

func sanitizeEndpointPart(value string) string {
	var builder strings.Builder

	for _, char := range value {
		if unicode.IsLetter(char) || unicode.IsDigit(char) {
			builder.WriteRune(char)
			continue
		}

		builder.WriteByte('_')
	}

	if builder.Len() == 0 {
		return "unknown"
	}

	return builder.String()
}

func formatUint(value uint64) string {
	if value == 0 {
		return "0"
	}

	var digits [20]byte
	index := len(digits)

	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}

	return string(digits[index:])
}

type messageDeduper struct {
	window  time.Duration
	seenIDs map[string]time.Time
}

func newMessageDeduper(window time.Duration) *messageDeduper {
	return &messageDeduper{
		window:  window,
		seenIDs: make(map[string]time.Time),
	}
}

func (deduper *messageDeduper) markSeen(id string, now time.Time) bool {
	deduper.expire(now)

	if expiresAt, ok := deduper.seenIDs[id]; ok && now.Before(expiresAt) {
		return false
	}

	deduper.seenIDs[id] = now.Add(deduper.window)
	return true
}

func (deduper *messageDeduper) expire(now time.Time) {
	for id, expiresAt := range deduper.seenIDs {
		if !now.Before(expiresAt) {
			delete(deduper.seenIDs, id)
		}
	}
}
