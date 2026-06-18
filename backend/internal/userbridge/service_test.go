package userbridge

import (
	"context"
	"encoding/json"
	"testing"

	"jena/backend/internal/eventbus"
	"jena/backend/internal/websocketbridge"
)

func TestServiceForwardsUserMessagesToStableUserConnections(t *testing.T) {
	bus := eventbus.New()
	service := New(bus)
	defer service.Dispose()

	publishUserConnected(t, bus, "ws.127_0_0_1_1", "test-user")
	publishUserConnected(t, bus, "ws.127_0_0_1_2", "test-user")
	publishUserConnected(t, bus, "ws.127_0_0_1_3", "other-user")

	received := map[string]int{}
	unlistenFirst := bus.Listen("ws.127_0_0_1_1.user-trigger-store.updated", func(_ context.Context, _ eventbus.Envelope) {
		received["first"]++
	})
	defer unlistenFirst()
	unlistenSecond := bus.Listen("ws.127_0_0_1_2.user-trigger-store.updated", func(_ context.Context, _ eventbus.Envelope) {
		received["second"]++
	})
	defer unlistenSecond()
	unlistenOther := bus.Listen("ws.127_0_0_1_3.user-trigger-store.updated", func(_ context.Context, _ eventbus.Envelope) {
		received["other"]++
	})
	defer unlistenOther()

	source := "test"
	if err := bus.Send(context.Background(), eventbus.Envelope{
		Destination: "user.test-user.user-trigger-store.updated",
		Payload:     json.RawMessage(`{"ok":true}`),
		Source:      &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if received["first"] != 1 || received["second"] != 1 {
		t.Fatalf("received %#v, want both test-user connections", received)
	}
	if received["other"] != 0 {
		t.Fatalf("other user received %d messages, want 0", received["other"])
	}
}

func TestServiceStopsForwardingDisconnectedSources(t *testing.T) {
	bus := eventbus.New()
	service := New(bus)
	defer service.Dispose()

	publishUserConnected(t, bus, "ws.127_0_0_1_1", "test-user")
	publishUserDisconnected(t, bus, "ws.127_0_0_1_1", "test-user")

	received := 0
	unlisten := bus.Listen("ws.127_0_0_1_1.user-trigger-store.updated", func(_ context.Context, _ eventbus.Envelope) {
		received++
	})
	defer unlisten()

	source := "test"
	if err := bus.Send(context.Background(), eventbus.Envelope{
		Destination: "user.test-user.user-trigger-store.updated",
		Payload:     json.RawMessage(`{"ok":true}`),
		Source:      &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if received != 0 {
		t.Fatalf("received %d messages, want 0", received)
	}
}

func TestServiceDoesNotCreateAnonymousFanoutBucket(t *testing.T) {
	bus := eventbus.New()
	service := New(bus)
	defer service.Dispose()

	publishUserConnected(t, bus, "ws.127_0_0_1_1", "")
	publishUserConnected(t, bus, "ws.127_0_0_1_2", "  ")

	received := 0
	unlistenFirst := bus.Listen("ws.127_0_0_1_1.user-trigger-store.updated", func(_ context.Context, _ eventbus.Envelope) {
		received++
	})
	defer unlistenFirst()
	unlistenSecond := bus.Listen("ws.127_0_0_1_2.user-trigger-store.updated", func(_ context.Context, _ eventbus.Envelope) {
		received++
	})
	defer unlistenSecond()

	source := "test"
	for _, destination := range []string{
		"user..user-trigger-store.updated",
		"user. .user-trigger-store.updated",
	} {
		if err := bus.Send(context.Background(), eventbus.Envelope{
			Destination: destination,
			Payload:     json.RawMessage(`{"ok":true}`),
			Source:      &source,
		}); err != nil {
			t.Fatalf("Send returned error: %v", err)
		}
	}

	if received != 0 {
		t.Fatalf("received %d messages, want 0", received)
	}
}

func TestServiceMovesSourceWhenStableUserChanges(t *testing.T) {
	bus := eventbus.New()
	service := New(bus)
	defer service.Dispose()

	publishUserConnected(t, bus, "ws.127_0_0_1_1", "first-user")
	publishUserConnected(t, bus, "ws.127_0_0_1_1", "second-user")

	firstReceived := 0
	secondReceived := 0
	unlistenFirst := bus.Listen("ws.127_0_0_1_1.first", func(_ context.Context, _ eventbus.Envelope) {
		firstReceived++
	})
	defer unlistenFirst()
	unlistenSecond := bus.Listen("ws.127_0_0_1_1.second", func(_ context.Context, _ eventbus.Envelope) {
		secondReceived++
	})
	defer unlistenSecond()

	source := "test"
	_ = bus.Send(context.Background(), eventbus.Envelope{
		Destination: "user.first-user.first",
		Payload:     json.RawMessage(`{}`),
		Source:      &source,
	})
	_ = bus.Send(context.Background(), eventbus.Envelope{
		Destination: "user.second-user.second",
		Payload:     json.RawMessage(`{}`),
		Source:      &source,
	})

	if firstReceived != 0 {
		t.Fatalf("firstReceived %d, want 0", firstReceived)
	}
	if secondReceived != 1 {
		t.Fatalf("secondReceived %d, want 1", secondReceived)
	}
}

func publishUserConnected(t *testing.T, bus *eventbus.Bus, source string, stableUserID string) {
	t.Helper()
	publishUserConnectionEvent(t, bus, websocketbridge.UserConnectedEndpoint, source, stableUserID)
}

func publishUserDisconnected(t *testing.T, bus *eventbus.Bus, source string, stableUserID string) {
	t.Helper()
	publishUserConnectionEvent(t, bus, websocketbridge.UserDisconnectedEndpoint, source, stableUserID)
}

func publishUserConnectionEvent(t *testing.T, bus *eventbus.Bus, destination string, source string, stableUserID string) {
	t.Helper()

	payload, err := json.Marshal(websocketbridge.UserConnectionEvent{
		Source:       source,
		StableUserID: stableUserID,
	})
	if err != nil {
		t.Fatalf("Marshal user connection event returned error: %v", err)
	}

	eventSource := "test"
	if err := bus.Send(context.Background(), eventbus.Envelope{
		Destination: destination,
		Payload:     payload,
		Source:      &eventSource,
	}); err != nil {
		t.Fatalf("Send user connection event returned error: %v", err)
	}
}
