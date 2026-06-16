package websocketbridge

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/coder/websocket"

	"jena/backend/internal/eventbus"
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
)

type Bridge struct {
	bus        *eventbus.Bus
	connection uint64
}

type frame struct {
	Type      string             `json:"type"`
	Seq       uint64             `json:"seq,omitempty"`
	Ack       uint64             `json:"ack,omitempty"`
	AuthToken string             `json:"authToken,omitempty"`
	Envelope  *eventbus.Envelope `json:"envelope,omitempty"`
}

type connection struct {
	bridge      *Bridge
	conn        *websocket.Conn
	name        string
	outbound    chan eventbus.Envelope
	ackOutbound chan uint64
	ackReceived chan uint64
	deduper     *messageDeduper
}

func New(bus *eventbus.Bus) *Bridge {
	return &Bridge{
		bus: bus,
	}
}

func (bridge *Bridge) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	socket, err := websocket.Accept(response, request, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		slog.Warn("websocket accept failed", "error", err)
		return
	}
	socket.SetReadLimit(readLimitBytes)

	connectionID := atomic.AddUint64(&bridge.connection, 1)
	connection := &connection{
		bridge:      bridge,
		conn:        socket,
		name:        makeConnectionName(request.RemoteAddr, connectionID),
		outbound:    make(chan eventbus.Envelope, outboundQueueSize),
		ackOutbound: make(chan uint64, 16),
		ackReceived: make(chan uint64, 16),
		deduper:     newMessageDeduper(dedupWindow),
	}

	connection.run(request.Context())
}

func (connection *connection) run(parentCtx context.Context) {
	ctx, cancel := context.WithCancel(parentCtx)
	defer cancel()
	defer connection.conn.Close(websocket.StatusNormalClosure, "closed")

	unlisten := connection.bridge.bus.Listen(connection.name+".*", func(_ context.Context, envelope eventbus.Envelope) {
		envelope.Destination = strings.TrimPrefix(envelope.Destination, connection.name+".")

		select {
		case connection.outbound <- envelope:
		case <-ctx.Done():
		default:
			slog.Warn("websocket outbound queue is full", "connection", connection.name)
			cancel()
		}
	})
	defer unlisten()

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)

	go func() {
		defer waitGroup.Done()
		if err := connection.readLoop(ctx); err != nil {
			slog.Debug("websocket read loop ended", "connection", connection.name, "error", err)
		}
		cancel()
	}()

	go func() {
		defer waitGroup.Done()
		if err := connection.writeLoop(ctx); err != nil {
			slog.Debug("websocket write loop ended", "connection", connection.name, "error", err)
		}
		cancel()
	}()

	waitGroup.Wait()
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
			slog.Warn("invalid websocket frame", "connection", connection.name, "error", err)
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

			connection.receiveEnvelope(ctx, incoming.Seq, incoming.AuthToken, *incoming.Envelope)
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
			slog.Warn("unknown websocket frame type", "connection", connection.name, "type", incoming.Type)
		}
	}
}

func (connection *connection) receiveEnvelope(ctx context.Context, seq uint64, authToken string, envelope eventbus.Envelope) {
	source := connection.name
	if envelope.Source != nil && *envelope.Source != "" {
		source = connection.name + "." + *envelope.Source
	}

	if envelope.ID == "" {
		envelope.ID = eventbus.CreateMessageID()
	}
	if authToken != "" {
		envelope.AuthToken = authToken
	}
	envelope.Source = &source

	if connection.deduper.markSeen(envelope.ID, time.Now()) {
		if err := connection.bridge.bus.Send(ctx, envelope); err != nil {
			slog.Warn("failed to relay websocket envelope", "connection", connection.name, "error", err)
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
				AuthToken: envelope.AuthToken,
				Envelope:  &envelope,
				Seq:       nextSeq,
				Type:      frameTypeMessage,
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
