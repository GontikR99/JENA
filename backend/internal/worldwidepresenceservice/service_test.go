package worldwidepresenceservice

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"jena/backend/internal/eventbus"
)

func TestServiceMaintainsCharacterPresenceByWebsocketSource(t *testing.T) {
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval: time.Hour,
		PresenceTTL:     time.Minute,
	})
	defer service.Dispose()

	arias := CharacterPresence{
		Active:        true,
		CharacterName: "Arias",
		ServerName:    "bertox",
		Zone:          "The Nexus",
	}
	brell := CharacterPresence{
		Active:        true,
		CharacterName: "Brell",
		ServerName:    "bertox",
		Zone:          "The Nexus",
	}

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		arias,
		brell,
	})

	expectPresenceRecords(t, service, map[presenceKey]presenceRecord{
		getPresenceKey(arias): {
			Character:       arias,
			WebsocketSource: "ws.127_0_0_1_1",
		},
		getPresenceKey(brell): {
			Character:       brell,
			WebsocketSource: "ws.127_0_0_1_1",
		},
	})
}

func TestServiceReplacesCharactersMissingFromSameSource(t *testing.T) {
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval: time.Hour,
		PresenceTTL:     time.Minute,
	})
	defer service.Dispose()

	arias := CharacterPresence{
		Active:        true,
		CharacterName: "Arias",
		ServerName:    "bertox",
		Zone:          "The Nexus",
	}
	brell := CharacterPresence{
		Active:        true,
		CharacterName: "Brell",
		ServerName:    "bertox",
		Zone:          "The Nexus",
	}

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		arias,
		brell,
	})
	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		arias,
	})

	expectPresenceRecords(t, service, map[presenceKey]presenceRecord{
		getPresenceKey(arias): {
			Character:       arias,
			WebsocketSource: "ws.127_0_0_1_1",
		},
	})
}

func TestServiceTreatsInactiveOrEmptyZonePresenceAsDelete(t *testing.T) {
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval: time.Hour,
		PresenceTTL:     time.Minute,
	})
	defer service.Dispose()

	arias := CharacterPresence{
		Active:        true,
		CharacterName: "Arias",
		ServerName:    "bertox",
		Zone:          "The Nexus",
	}
	brell := CharacterPresence{
		Active:        true,
		CharacterName: "Brell",
		ServerName:    "bertox",
		Zone:          "The Nexus",
	}

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		arias,
		brell,
	})
	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		arias,
		{
			Active:        false,
			CharacterName: "Brell",
			ServerName:    "bertox",
			Zone:          "The Nexus",
		},
	})

	expectPresenceRecords(t, service, map[presenceKey]presenceRecord{
		getPresenceKey(arias): {
			Character:       arias,
			WebsocketSource: "ws.127_0_0_1_1",
		},
	})
}

func TestServiceExpiresStalePresence(t *testing.T) {
	now := time.Date(2026, 6, 19, 12, 0, 0, 0, time.UTC)
	bus := eventbus.New()
	service := NewWithOptions(bus, Options{
		CleanupInterval: time.Hour,
		Now: func() time.Time {
			return now
		},
		PresenceTTL: time.Minute,
	})
	defer service.Dispose()

	arias := CharacterPresence{
		Active:        true,
		CharacterName: "Arias",
		ServerName:    "bertox",
		Zone:          "The Nexus",
	}

	sendPresence(t, bus, "ws.127_0_0_1_1.worker.character-presence", []CharacterPresence{
		arias,
	})
	now = now.Add(61 * time.Second)
	service.mu.Lock()
	service.expireStaleLocked(now)
	service.mu.Unlock()

	expectPresenceRecords(t, service, map[presenceKey]presenceRecord{})
}

func sendPresence(
	t *testing.T,
	bus *eventbus.Bus,
	source string,
	characters []CharacterPresence,
) {
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

func expectPresenceRecords(
	t *testing.T,
	service *Service,
	expected map[presenceKey]presenceRecord,
) {
	t.Helper()

	service.mu.Lock()
	defer service.mu.Unlock()

	if len(service.records) != len(expected) {
		t.Fatalf("records %#v, want %#v", service.records, expected)
	}

	for key, expectedRecord := range expected {
		record, ok := service.records[key]
		if !ok {
			t.Fatalf("missing record for key %#v", key)
		}
		if record.Character != expectedRecord.Character {
			t.Fatalf("record character %#v, want %#v", record.Character, expectedRecord.Character)
		}
		if record.WebsocketSource != expectedRecord.WebsocketSource {
			t.Fatalf(
				"record websocket source %q, want %q",
				record.WebsocketSource,
				expectedRecord.WebsocketSource,
			)
		}
	}
}
