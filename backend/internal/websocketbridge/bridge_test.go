package websocketbridge

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"jena/backend/internal/config"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
)

func TestMakeConnectionNameUsesIPv4WithUnderscores(t *testing.T) {
	name := makeConnectionName("127.0.0.1:5000", 12)

	if name != "ws.127_0_0_1_12" {
		t.Fatalf("name %q, want ws.127_0_0_1_12", name)
	}
}

func TestMakeConnectionNameSanitizesNonIPv4(t *testing.T) {
	name := makeConnectionName("[::1]:5000", 7)

	if name != "ws.__1_7" {
		t.Fatalf("name %q, want ws.__1_7", name)
	}
}

func TestMessageDeduperExpiresIDs(t *testing.T) {
	deduper := newMessageDeduper(10 * time.Minute)
	now := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)

	if !deduper.markSeen("message-1", now) {
		t.Fatal("first message should be new")
	}
	if deduper.markSeen("message-1", now.Add(time.Minute)) {
		t.Fatal("duplicate message should be suppressed")
	}
	if !deduper.markSeen("message-1", now.Add(11*time.Minute)) {
		t.Fatal("expired message should be accepted again")
	}
}

func TestReceiveEnvelopeDeduplicatesBeforeSendingToBus(t *testing.T) {
	bus := eventbus.New()
	bridge := New(bus, logging.NewNop())
	connection := &connection{
		ackOutbound: make(chan uint64, 2),
		bridge:      bridge,
		deduper:     newMessageDeduper(dedupWindow),
		name:        "ws.127_0_0_1_1",
	}
	received := 0

	unlisten := bus.Listen("service", func(_ context.Context, envelope eventbus.Envelope) {
		received++

		if envelope.AuthToken != "token-1" {
			t.Fatalf("AuthToken %q, want token-1", envelope.AuthToken)
		}
		if envelope.Source == nil || *envelope.Source != "ws.127_0_0_1_1.test" {
			t.Fatalf("Source %v, want ws.127_0_0_1_1.test", envelope.Source)
		}
	})
	defer unlisten()

	source := "test"
	envelope := eventbus.Envelope{
		Destination: "service",
		ID:          "message-1",
		Payload:     json.RawMessage(`{}`),
		Source:      &source,
	}

	connection.receiveEnvelope(context.Background(), 1, "token-1", envelope)
	connection.receiveEnvelope(context.Background(), 2, "token-1", envelope)

	if received != 1 {
		t.Fatalf("received %d messages, want 1", received)
	}
}

func TestLogActiveConnectionsUsesInfoLevel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jena.log")
	logger, err := logging.New(config.Config{
		LogFilePath: path,
		LogLevel:    "info",
		LogTarget:   "file",
	})
	if err != nil {
		t.Fatalf("logging.New returned error: %v", err)
	}

	bridge := New(eventbus.New(), logger)
	bridge.activeConnections.Store(3)

	bridge.logActiveConnections(context.Background())

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

	if record["level"] != "info" {
		t.Fatalf("level %v, want info", record["level"])
	}
	if record["message"] != "websocket active connection count" {
		t.Fatalf("message %v, want websocket active connection count", record["message"])
	}
	if record["activeConnections"] != float64(3) {
		t.Fatalf("activeConnections %v, want 3", record["activeConnections"])
	}
}
