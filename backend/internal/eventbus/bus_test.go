package eventbus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"jena/backend/internal/config"
	"jena/backend/internal/logging"
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

func TestRegisterRPCLogsHandledCall(t *testing.T) {
	bus := New()
	path := filepath.Join(t.TempDir(), "jena.log")
	logger, err := logging.New(config.Config{
		LogFilePath: path,
		LogLevel:    "debug",
		LogTarget:   "file",
	})
	if err != nil {
		t.Fatalf("logging.New returned error: %v", err)
	}
	bus.SetLogger(logger)
	source := "ws.127_0_0_1_1.test"

	unlistenResponse := bus.Listen(source, func(context.Context, Envelope) {})
	defer unlistenResponse()

	unregister := bus.RegisterRPC("service", map[string]RPCHandler{
		"ping": func(_ context.Context, _ RPCMetadata, _ json.RawMessage) (any, error) {
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
		UserIdentity: UserIdentity{
			DisplayName:  "Display Name",
			Snowflake:    "177935991334502400",
			StableUserID: "discord:177935991334502400",
			Username:     "discord-user",
		},
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if err := logger.Close(); err != nil {
		t.Fatalf("logger.Close returned error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}

	var record map[string]any
	if err := json.Unmarshal(data, &record); err != nil {
		t.Fatalf("Unmarshal returned error: %v", err)
	}

	expected := map[string]any{
		"displayName":  "Display Name",
		"destination":  "service",
		"message":      "backend rpc handled",
		"method":       "ping",
		"ok":           true,
		"snowflake":    "177935991334502400",
		"source":       source,
		"stableUserId": "discord:177935991334502400",
		"topic":        "service",
		"username":     "discord-user",
	}
	for key, value := range expected {
		if record[key] != value {
			t.Fatalf("%s %v, want %v in record %#v", key, record[key], value, record)
		}
	}
}
