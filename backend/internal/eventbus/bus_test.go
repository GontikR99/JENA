package eventbus

import (
	"context"
	"encoding/json"
	"testing"
)

func TestBusRoutesByDestinationPattern(t *testing.T) {
	bus := New()
	received := 0

	unlisten := bus.Listen("file-watcher.*", func(context.Context, Envelope) {
		received++
	})
	defer unlisten()

	if err := bus.Send(context.Background(), Envelope{
		Destination: "file-watcher.characters",
		Payload:     json.RawMessage(`{}`),
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if received != 1 {
		t.Fatalf("received %d messages, want 1", received)
	}
}

func TestRegisterRPCPassesSenderToHandler(t *testing.T) {
	bus := New()
	source := "ws.127_0_0_1_1.test"
	var handlerSender string
	var response Envelope

	unlistenResponse := bus.Listen(source, func(_ context.Context, envelope Envelope) {
		response = envelope
	})
	defer unlistenResponse()

	unregister := bus.RegisterRPC("service", map[string]RPCHandler{
		"ping": func(_ context.Context, metadata RPCMetadata, _ json.RawMessage) (any, error) {
			handlerSender = metadata.Sender
			return map[string]string{"pong": "ok"}, nil
		},
	})
	defer unregister()

	payload := json.RawMessage(`{"method":"ping","params":{}}`)
	if err := bus.Send(context.Background(), Envelope{
		CorrelationID: "rpc-1",
		Destination:   "service",
		Payload:       payload,
		Source:        &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if handlerSender != source {
		t.Fatalf("handler sender %q, want %q", handlerSender, source)
	}
	if response.CorrelationID != "rpc-1" {
		t.Fatalf("response correlation %q, want rpc-1", response.CorrelationID)
	}
}

func TestRegisterRPCPassesAuthTokenToHandler(t *testing.T) {
	bus := New()
	source := "ws.127_0_0_1_1.test"
	var handlerAuthToken string

	unlistenResponse := bus.Listen(source, func(context.Context, Envelope) {})
	defer unlistenResponse()

	unregister := bus.RegisterRPC("service", map[string]RPCHandler{
		"ping": func(_ context.Context, metadata RPCMetadata, _ json.RawMessage) (any, error) {
			handlerAuthToken = metadata.AuthToken
			return map[string]string{"pong": "ok"}, nil
		},
	})
	defer unregister()

	payload := json.RawMessage(`{"method":"ping","params":{}}`)
	if err := bus.Send(context.Background(), Envelope{
		AuthToken:     "token-1",
		CorrelationID: "rpc-1",
		Destination:   "service",
		Payload:       payload,
		Source:        &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if handlerAuthToken != "token-1" {
		t.Fatalf("handler auth token %q, want token-1", handlerAuthToken)
	}
}
