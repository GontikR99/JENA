package eventbus

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"sync"
	"time"

	"jena/backend/internal/logging"
)

type Envelope struct {
	ID            string          `json:"id"`
	AuthToken     string          `json:"authToken,omitempty"`
	Source        *string         `json:"source"`
	Destination   string          `json:"destination"`
	CorrelationID string          `json:"correlationId,omitempty"`
	Payload       json.RawMessage `json:"payload"`
	UserIdentity  UserIdentity    `json:"-"`
}

type UserIdentity struct {
	DisplayName  string
	Snowflake    string
	StableUserID string
	Username     string
}

type SerializedError struct {
	Name    string `json:"name,omitempty"`
	Message string `json:"message"`
}

type RPCRequestPayload struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type RPCResponsePayload struct {
	OK     bool             `json:"ok"`
	Result any              `json:"result,omitempty"`
	Error  *SerializedError `json:"error,omitempty"`
}

type Listener func(context.Context, Envelope)
type RPCMetadata struct {
	AuthToken string
	Envelope  Envelope
	Sender    string
}
type RPCHandler func(ctx context.Context, metadata RPCMetadata, params json.RawMessage) (any, error)

type Bus struct {
	mu             sync.RWMutex
	logger         logging.Logger
	nextListenerID uint64
	listeners      map[uint64]listenerRegistration
}

type listenerRegistration struct {
	pattern  string
	listener Listener
}

func New() *Bus {
	return &Bus{
		logger:    logging.NewNop(),
		listeners: make(map[uint64]listenerRegistration),
	}
}

func (bus *Bus) SetLogger(logger logging.Logger) {
	bus.mu.Lock()
	defer bus.mu.Unlock()

	if logger == nil {
		logger = logging.NewNop()
	}
	bus.logger = logger
}

func (bus *Bus) Listen(pattern string, listener Listener) func() {
	bus.mu.Lock()
	defer bus.mu.Unlock()

	bus.nextListenerID++
	id := bus.nextListenerID
	bus.listeners[id] = listenerRegistration{
		pattern:  pattern,
		listener: listener,
	}

	return func() {
		bus.mu.Lock()
		defer bus.mu.Unlock()

		delete(bus.listeners, id)
	}
}

func (bus *Bus) Send(ctx context.Context, envelope Envelope) error {
	if envelope.ID == "" {
		envelope.ID = CreateMessageID()
	}

	bus.mu.RLock()
	listeners := make([]Listener, 0, len(bus.listeners))
	for _, registration := range bus.listeners {
		if endpointMatches(registration.pattern, envelope.Destination) {
			listeners = append(listeners, registration.listener)
		}
	}
	bus.mu.RUnlock()

	for _, listener := range listeners {
		listener(ctx, envelope)
	}

	return nil
}

func (bus *Bus) RegisterRPC(endpoint string, handlers map[string]RPCHandler) func() {
	return bus.Listen(endpoint, func(ctx context.Context, envelope Envelope) {
		if envelope.CorrelationID == "" || envelope.Source == nil {
			return
		}

		startedAt := time.Now()
		var request RPCRequestPayload
		if err := json.Unmarshal(envelope.Payload, &request); err != nil {
			bus.sendRPCError(ctx, endpoint, *envelope.Source, envelope.CorrelationID, err)
			bus.logRPC(ctx, endpoint, envelope, "", false, startedAt, err)
			return
		}

		handler, ok := handlers[request.Method]
		if !ok {
			err := fmt.Errorf("unknown RPC method %q", request.Method)
			bus.sendRPCError(
				ctx,
				endpoint,
				*envelope.Source,
				envelope.CorrelationID,
				err,
			)
			bus.logRPC(ctx, endpoint, envelope, request.Method, false, startedAt, err)
			return
		}

		result, err := handler(ctx, RPCMetadata{
			AuthToken: envelope.AuthToken,
			Envelope:  envelope,
			Sender:    *envelope.Source,
		}, request.Params)
		if err != nil {
			bus.sendRPCError(ctx, endpoint, *envelope.Source, envelope.CorrelationID, err)
			bus.logRPC(ctx, endpoint, envelope, request.Method, false, startedAt, err)
			return
		}

		bus.sendRPCResponse(ctx, endpoint, *envelope.Source, envelope.CorrelationID, RPCResponsePayload{
			OK:     true,
			Result: result,
		})
		bus.logRPC(ctx, endpoint, envelope, request.Method, true, startedAt, nil)
	})
}

func (bus *Bus) logRPC(
	ctx context.Context,
	endpoint string,
	envelope Envelope,
	method string,
	ok bool,
	startedAt time.Time,
	err error,
) {
	bus.mu.RLock()
	logger := bus.logger
	bus.mu.RUnlock()

	source := ""
	if envelope.Source != nil {
		source = *envelope.Source
	}
	duration := time.Since(startedAt)
	fields := []logging.Field{
		logging.String("source", source),
		logging.String("destination", envelope.Destination),
		logging.String("topic", endpoint),
		logging.String("method", method),
		logging.Bool("ok", ok),
		logging.String("stableUserId", envelope.UserIdentity.StableUserID),
		logging.String("username", envelope.UserIdentity.Username),
		logging.String("snowflake", envelope.UserIdentity.Snowflake),
		logging.String("displayName", envelope.UserIdentity.DisplayName),
		logging.Int64("durationMs", duration.Milliseconds()),
		logging.Int64("durationUs", duration.Microseconds()),
	}
	if err != nil {
		fields = append(fields, logging.Error(err))
	}

	logger.Debug(ctx, "backend rpc handled", fields...)
}

func (bus *Bus) sendRPCError(
	ctx context.Context,
	source string,
	destination string,
	correlationID string,
	err error,
) {
	bus.sendRPCResponse(ctx, source, destination, correlationID, RPCResponsePayload{
		OK: false,
		Error: &SerializedError{
			Message: err.Error(),
		},
	})
}

func (bus *Bus) sendRPCResponse(
	ctx context.Context,
	source string,
	destination string,
	correlationID string,
	response RPCResponsePayload,
) {
	payload, err := json.Marshal(response)
	if err != nil {
		payload = []byte(`{"ok":false,"error":{"message":"failed to encode RPC response"}}`)
	}

	_ = bus.Send(ctx, Envelope{
		CorrelationID: correlationID,
		Destination:   destination,
		Payload:       payload,
		Source:        &source,
	})
}

func CreateMessageID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "message-id-unavailable"
	}

	return hex.EncodeToString(bytes)
}

func endpointMatches(pattern string, endpoint string) bool {
	matched, err := path.Match(pattern, endpoint)
	if err != nil {
		return pattern == endpoint
	}

	return matched
}
