package model

import "testing"

func TestWithCanonicalTriggerIDReturnsCopyWithCanonicalID(t *testing.T) {
	trigger := createTestTrigger()
	trigger.ID = "temporary-id"

	canonicalTrigger, err := WithCanonicalTriggerID(trigger)
	if err != nil {
		t.Fatalf("WithCanonicalTriggerID returned error: %v", err)
	}

	if canonicalTrigger.ID != "ec172b74-8ad6-7395-7e51-493680dd13fd" {
		t.Fatalf("ID %q, want ec172b74-8ad6-7395-7e51-493680dd13fd", canonicalTrigger.ID)
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

func createTestTrigger() Trigger {
	return Trigger{
		ID:        "draft-trigger",
		Name:      "Test Trigger",
		Comments:  "",
		Category:  "Default",
		GroupPath: []string{},
		Match:     "^test$",
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
			EarlyEnders: []TimerEarlyEnder{"done"},
		},
	}
}
