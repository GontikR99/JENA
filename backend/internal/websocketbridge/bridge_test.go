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
	bridge := New(bus, logging.NewNop(), "jena_session", nil)
	connection := &connection{
		ackOutbound: make(chan uint64, 2),
		authToken:   "token-1",
		bridge:      bridge,
		deduper:     newMessageDeduper(dedupWindow),
		name:        "ws.127_0_0_1_1",
		userIdentity: eventbus.UserIdentity{
			DisplayName:  "Display Name",
			Snowflake:    "177935991334502400",
			StableUserID: "discord:177935991334502400",
			Username:     "discord-user",
		},
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
		if envelope.UserIdentity.Username != "discord-user" {
			t.Fatalf("UserIdentity %#v, want discord user identity", envelope.UserIdentity)
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

	connection.receiveEnvelope(context.Background(), 1, envelope)
	connection.receiveEnvelope(context.Background(), 2, envelope)

	if received != 1 {
		t.Fatalf("received %d messages, want 1", received)
	}
}

func TestConnectionPublishesStableUserConnectionEvents(t *testing.T) {
	bus := eventbus.New()
	bridge := New(bus, logging.NewNop(), "jena_session", nil)
	connection := &connection{
		bridge:       bridge,
		name:         "ws.127_0_0_1_1",
		stableUserID: "user-1",
	}
	events := []UserConnectionEvent{}

	unlisten := bus.Listen(UserConnectedEndpoint, func(_ context.Context, envelope eventbus.Envelope) {
		var event UserConnectionEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil {
			t.Fatalf("Unmarshal connection event returned error: %v", err)
		}
		events = append(events, event)
	})
	defer unlisten()

	connection.publishUserConnectionEvent(context.Background(), UserConnectedEndpoint)

	if len(events) != 1 {
		t.Fatalf("received %d events, want 1", len(events))
	}
	if events[0].Source != "ws.127_0_0_1_1" || events[0].StableUserID != "user-1" {
		t.Fatalf("event %#v, want source and stable user", events[0])
	}
}

func TestResolveStableUserIDUsesAuthToken(t *testing.T) {
	bridge := New(eventbus.New(), logging.NewNop(), "jena_session", fakeStableUserResolver{
		stableUserID: "user-1",
	})

	stableUserID := bridge.resolveStableUserID(context.Background(), "token-1")

	if stableUserID != "user-1" {
		t.Fatalf("stableUserID %q, want user-1", stableUserID)
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

	bridge := New(eventbus.New(), logger, "jena_session", nil)
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

type fakeStableUserResolver struct {
	stableUserID string
}

func (resolver fakeStableUserResolver) StableIDForAuthToken(_ context.Context, authToken *string) (string, error) {
	if authToken == nil || *authToken == "" {
		return "", nil
	}

	return resolver.stableUserID, nil
}
