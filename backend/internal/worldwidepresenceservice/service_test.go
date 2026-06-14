package worldwidepresenceservice

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"jena/backend/internal/eventbus"
)

func TestServiceSendsNearbyPresenceGroupedByServerAndZone(t *testing.T) {
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval: time.Hour,
		NotifyDebounce:  time.Millisecond,
		PresenceTTL:     time.Minute,
	})
	defer service.Dispose()

	var mu sync.Mutex
	received := make(map[string]NearbyPresenceMessage)
	unlisten := bus.Listen("ws.*.worldwide-presence.nearby-characters", func(_ context.Context, envelope eventbus.Envelope) {
		var message NearbyPresenceMessage
		if err := json.Unmarshal(envelope.Payload, &message); err != nil {
			t.Errorf("Unmarshal returned error: %v", err)
			return
		}

		mu.Lock()
		defer mu.Unlock()
		received[envelope.Destination] = message
	})
	defer unlisten()

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_2.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_3.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Cazic", ServerName: "bertox", Zone: "Plane of Knowledge"},
	})

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == 3
	})

	mu.Lock()
	snapshot := cloneNearbyMessages(received)
	mu.Unlock()

	expectCharacters(t, snapshot["ws.127_0_0_1_1.worldwide-presence.nearby-characters"], []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	expectCharacters(t, snapshot["ws.127_0_0_1_2.worldwide-presence.nearby-characters"], []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	expectCharacters(t, snapshot["ws.127_0_0_1_3.worldwide-presence.nearby-characters"], []CharacterPresence{
		{Active: true, CharacterName: "Cazic", ServerName: "bertox", Zone: "Plane of Knowledge"},
	})
}

func TestServiceExpiresStalePresenceAndNotifiesAffectedSources(t *testing.T) {
	now := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval: time.Millisecond,
		NotifyDebounce:  time.Millisecond,
		Now: func() time.Time {
			return now
		},
		PresenceTTL: time.Minute,
	})
	defer service.Dispose()

	var mu sync.Mutex
	var ariasMessages []NearbyPresenceMessage
	unlisten := bus.Listen("ws.127_0_0_1_1.worldwide-presence.nearby-characters", func(_ context.Context, envelope eventbus.Envelope) {
		var message NearbyPresenceMessage
		if err := json.Unmarshal(envelope.Payload, &message); err != nil {
			t.Errorf("Unmarshal returned error: %v", err)
			return
		}

		mu.Lock()
		defer mu.Unlock()
		ariasMessages = append(ariasMessages, message)
	})
	defer unlisten()

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_2.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(ariasMessages) == 1
	})

	now = now.Add(30 * time.Second)
	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
	})

	now = now.Add(31 * time.Second)

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(ariasMessages) == 2
	})

	mu.Lock()
	message := ariasMessages[1]
	mu.Unlock()

	expectCharacters(t, message, []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
	})
}

func TestServiceTreatsInactiveOrEmptyZonePresenceAsDelete(t *testing.T) {
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval:       time.Hour,
		FullBroadcastInterval: time.Hour,
		NotifyDebounce:        time.Millisecond,
		PresenceTTL:           time.Minute,
	})
	defer service.Dispose()

	var mu sync.Mutex
	var ariasMessages []NearbyPresenceMessage
	unlisten := bus.Listen("ws.127_0_0_1_1.worldwide-presence.nearby-characters", func(_ context.Context, envelope eventbus.Envelope) {
		var message NearbyPresenceMessage
		if err := json.Unmarshal(envelope.Payload, &message); err != nil {
			t.Errorf("Unmarshal returned error: %v", err)
			return
		}

		mu.Lock()
		defer mu.Unlock()
		ariasMessages = append(ariasMessages, message)
	})
	defer unlisten()

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_2.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_3.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Cazic", ServerName: "bertox", Zone: "The Nexus"},
	})

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()

		if len(ariasMessages) == 0 {
			return false
		}

		return len(ariasMessages[len(ariasMessages)-1].Characters) == 3
	})

	sendPresence(t, bus, "ws.127_0_0_1_2.worker.character-presence", []CharacterPresence{
		{Active: false, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_3.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Cazic", ServerName: "bertox", Zone: "   "},
	})

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()

		if len(ariasMessages) == 0 {
			return false
		}

		lastMessage := ariasMessages[len(ariasMessages)-1]
		return len(lastMessage.Characters) == 1 &&
			lastMessage.Characters[0].CharacterName == "Arias"
	})

	mu.Lock()
	message := ariasMessages[len(ariasMessages)-1]
	mu.Unlock()

	expectCharacters(t, message, []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
	})
}

func TestServicePeriodicallySendsFullNearbyPresence(t *testing.T) {
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval:       time.Hour,
		FullBroadcastInterval: 5 * time.Millisecond,
		NotifyDebounce:        time.Millisecond,
		PresenceTTL:           time.Minute,
	})
	defer service.Dispose()

	var mu sync.Mutex
	received := make(map[string]NearbyPresenceMessage)
	unlisten := bus.Listen("ws.*.worldwide-presence.nearby-characters", func(_ context.Context, envelope eventbus.Envelope) {
		var message NearbyPresenceMessage
		if err := json.Unmarshal(envelope.Payload, &message); err != nil {
			t.Errorf("Unmarshal returned error: %v", err)
			return
		}

		mu.Lock()
		defer mu.Unlock()
		received[envelope.Destination] = message
	})
	defer unlisten()

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_2.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	sendPresence(t, bus, "ws.127_0_0_1_3.worker.character-presence", []CharacterPresence{
		{Active: true, CharacterName: "Cazic", ServerName: "bertox", Zone: "Plane of Knowledge"},
	})

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == 3
	})

	mu.Lock()
	received = make(map[string]NearbyPresenceMessage)
	mu.Unlock()

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == 3
	})

	mu.Lock()
	snapshot := cloneNearbyMessages(received)
	mu.Unlock()

	expectCharacters(t, snapshot["ws.127_0_0_1_1.worldwide-presence.nearby-characters"], []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	expectCharacters(t, snapshot["ws.127_0_0_1_2.worldwide-presence.nearby-characters"], []CharacterPresence{
		{Active: true, CharacterName: "Arias", ServerName: "bertox", Zone: "The Nexus"},
		{Active: true, CharacterName: "Brell", ServerName: "bertox", Zone: "The Nexus"},
	})
	expectCharacters(t, snapshot["ws.127_0_0_1_3.worldwide-presence.nearby-characters"], []CharacterPresence{
		{Active: true, CharacterName: "Cazic", ServerName: "bertox", Zone: "Plane of Knowledge"},
	})
}

func sendPresence(t *testing.T, bus *eventbus.Bus, source string, characters []CharacterPresence) {
	t.Helper()

	payload, err := json.Marshal(CharacterPresenceMessage{
		Characters: characters,
	})
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	if err := bus.Send(context.Background(), eventbus.Envelope{
		Destination: presenceSourceEndpoint,
		Payload:     payload,
		Source:      &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}
}

func expectCharacters(t *testing.T, message NearbyPresenceMessage, expected []CharacterPresence) {
	t.Helper()

	if len(message.Characters) != len(expected) {
		t.Fatalf("characters %#v, want %#v", message.Characters, expected)
	}

	for index, expectedCharacter := range expected {
		if message.Characters[index] != expectedCharacter {
			t.Fatalf("character %d %#v, want %#v", index, message.Characters[index], expectedCharacter)
		}
	}
}

func cloneNearbyMessages(messages map[string]NearbyPresenceMessage) map[string]NearbyPresenceMessage {
	clone := make(map[string]NearbyPresenceMessage, len(messages))
	for key, message := range messages {
		clone[key] = message
	}

	return clone
}

func waitFor(t *testing.T, predicate func() bool) {
	t.Helper()

	startedAt := time.Now()
	for !predicate() {
		if time.Since(startedAt) > time.Second {
			t.Fatal("timed out waiting for predicate")
		}

		time.Sleep(time.Millisecond)
	}
}
