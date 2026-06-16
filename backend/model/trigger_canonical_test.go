package model

import (
	"encoding/json"
	"testing"
)

func TestWithCanonicalTriggerIDReturnsCopyWithCanonicalID(t *testing.T) {
	trigger := createTestTrigger()
	trigger.ID = "temporary-id"

	canonicalTrigger, err := WithCanonicalTriggerID(trigger)
	if err != nil {
		t.Fatalf("WithCanonicalTriggerID returned error: %v", err)
	}

	if canonicalTrigger.ID != "6ed6237c-1da3-6cad-2875-f6513d1a8136" {
		t.Fatalf("ID %q, want 6ed6237c-1da3-6cad-2875-f6513d1a8136", canonicalTrigger.ID)
	}
	if trigger.ID != "temporary-id" {
		t.Fatalf("original trigger ID %q, want temporary-id", trigger.ID)
	}
}

func TestCanonicalTriggerIDIgnoresExistingID(t *testing.T) {
	first := createTestTrigger()
	first.ID = "first-id"
	second := createTestTrigger()
	second.ID = "second-id"

	firstID, err := CanonicalTriggerID(first)
	if err != nil {
		t.Fatalf("CanonicalTriggerID returned error: %v", err)
	}

	secondID, err := CanonicalTriggerID(second)
	if err != nil {
		t.Fatalf("CanonicalTriggerID returned error: %v", err)
	}

	if secondID != firstID {
		t.Fatalf("second ID %q, want %q", secondID, firstID)
	}
}

func TestCanonicalTriggerIDChangesWhenContentChanges(t *testing.T) {
	first := createTestTrigger()
	second := createTestTrigger()
	second.Name = "Different Trigger"

	firstID, err := CanonicalTriggerID(first)
	if err != nil {
		t.Fatalf("CanonicalTriggerID returned error: %v", err)
	}

	secondID, err := CanonicalTriggerID(second)
	if err != nil {
		t.Fatalf("CanonicalTriggerID returned error: %v", err)
	}

	if secondID == firstID {
		t.Fatal("expected different IDs for different trigger content")
	}
}

func TestCanonicalTriggerIDMatchesBrowserForUnescapedAngleBrackets(t *testing.T) {
	const encodedTrigger = `{"actions":{"display":{"enabled":false,"text":"Feigned Death - Stand Up"},"speech":{"enabled":true,"text":"Stand Up","interrupt":false},"clipboard":{"enabled":false,"text":""}},"category":"Debuffs","comments":"","groupPath":["AD Triggers","Raids","House of Thule","Tier 3","Guardian of the House (HoT Upper)"],"match":{"text":"a groundshattering golem begins to cast a spell\\. <Earthshock>","isRegex":true},"name":"A groundshattering golem - Earthshock","timer":{"type":"repeating","name":"FD/DD AE","durationMs":30000,"startBehavior":"restart","warningSeconds":0,"warningAction":null,"endedAction":null,"earlyEnders":[{"text":"end timer","isRegex":true},{"text":"you have been slain","isRegex":true},{"text":"a groundshattering golem has been slain","isRegex":true},{"text":"you have slain a ground","isRegex":true},{"text":"'s corpse falls to the ground","isRegex":true}]},"id":"69afb40d-fdfd-6419-4043-4ff2c1f885fc"}`

	var trigger Trigger
	if err := json.Unmarshal([]byte(encodedTrigger), &trigger); err != nil {
		t.Fatalf("Unmarshal trigger returned error: %v", err)
	}

	id, err := CanonicalTriggerID(trigger)
	if err != nil {
		t.Fatalf("CanonicalTriggerID returned error: %v", err)
	}

	if id != "69afb40d-fdfd-6419-4043-4ff2c1f885fc" {
		t.Fatalf("ID %q, want 69afb40d-fdfd-6419-4043-4ff2c1f885fc", id)
	}
}

func createTestTrigger() Trigger {
	return Trigger{
		ID:        "draft-trigger",
		Name:      "Test Trigger",
		Comments:  "",
		Category:  "Default",
		GroupPath: []string{},
		Match: TriggerMatcher{
			Text:    "^test$",
			IsRegex: true,
		},
		Actions: TriggerActions{
			Display: TextAction{
				Enabled: true,
				Text:    "Display",
			},
			Speech: SpeechAction{
				Enabled:   true,
				Text:      "Speak",
				Interrupt: true,
			},
			Clipboard: ClipboardAction{
				Enabled: true,
				Text:    "Copy",
			},
		},
		Timer: &TriggerTimer{
			Type:           TriggerTimerTypeCountdown,
			Name:           "Timer",
			DurationMs:     10_000,
			StartBehavior:  TimerStartBehaviorRestart,
			WarningSeconds: 5,
			WarningAction: &TimerAction{
				Display: TextAction{
					Enabled: true,
					Text:    "Warning display",
				},
				Speech: SpeechAction{
					Enabled:   true,
					Text:      "Warning speech",
					Interrupt: true,
				},
			},
			EndedAction: &TimerAction{
				Display: TextAction{
					Enabled: true,
					Text:    "Ended display",
				},
				Speech: SpeechAction{
					Enabled:   true,
					Text:      "Ended speech",
					Interrupt: false,
				},
			},
			EarlyEnders: []TimerEarlyEnder{
				{
					Text:    "done",
					IsRegex: true,
				},
			},
		},
	}
}
