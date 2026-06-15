package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

func WithCanonicalTriggerID(trigger Trigger) (Trigger, error) {
	id, err := CanonicalTriggerID(trigger)
	if err != nil {
		return Trigger{}, err
	}

	trigger.ID = id

	return trigger, nil
}

func CanonicalTriggerID(trigger Trigger) (TriggerID, error) {
	content := canonicalTriggerContent{
		Actions:   getTriggerActionsHashContent(trigger.Actions),
		Category:  trigger.Category,
		Comments:  trigger.Comments,
		GroupPath: cloneStringSlice(trigger.GroupPath),
		Match:     trigger.Match,
		Name:      trigger.Name,
		Timer:     getTriggerTimerHashContent(trigger.Timer),
	}

	encoded, err := json.Marshal(content)
	if err != nil {
		return "", fmt.Errorf("marshal canonical trigger content: %w", err)
	}

	digest := sha256.Sum256(encoded)
	hexDigest := hex.EncodeToString(digest[:16])

	return TriggerID(
		hexDigest[0:8] + "-" +
			hexDigest[8:12] + "-" +
			hexDigest[12:16] + "-" +
			hexDigest[16:20] + "-" +
			hexDigest[20:32],
	), nil
}

type canonicalTriggerContent struct {
	Actions   canonicalTriggerActions `json:"actions"`
	Category  string                  `json:"category"`
	Comments  string                  `json:"comments"`
	GroupPath []string                `json:"groupPath"`
	Match     TriggerMatcher          `json:"match"`
	Name      string                  `json:"name"`
	Timer     *canonicalTriggerTimer  `json:"timer"`
}

type canonicalTriggerActions struct {
	Display   canonicalTextAction   `json:"display"`
	Speech    canonicalSpeechAction `json:"speech"`
	Clipboard canonicalTextAction   `json:"clipboard"`
}

type canonicalTextAction struct {
	Enabled bool   `json:"enabled"`
	Text    string `json:"text"`
}

type canonicalSpeechAction struct {
	Enabled   bool   `json:"enabled"`
	Text      string `json:"text"`
	Interrupt bool   `json:"interrupt"`
}

type canonicalTriggerTimer struct {
	Type           TriggerTimerType      `json:"type"`
	Name           string                `json:"name"`
	DurationMs     int64                 `json:"durationMs"`
	StartBehavior  TimerStartBehavior    `json:"startBehavior"`
	WarningSeconds int64                 `json:"warningSeconds"`
	WarningAction  *canonicalTimerAction `json:"warningAction"`
	EndedAction    *canonicalTimerAction `json:"endedAction"`
	EarlyEnders    []TimerEarlyEnder     `json:"earlyEnders"`
}

type canonicalTimerAction struct {
	Display canonicalTextAction   `json:"display"`
	Speech  canonicalSpeechAction `json:"speech"`
}

func getTriggerActionsHashContent(actions TriggerActions) canonicalTriggerActions {
	return canonicalTriggerActions{
		Display:   getTextActionHashContent(actions.Display),
		Speech:    getSpeechActionHashContent(actions.Speech),
		Clipboard: getClipboardActionHashContent(actions.Clipboard),
	}
}

func getTriggerTimerHashContent(timer *TriggerTimer) *canonicalTriggerTimer {
	if timer == nil {
		return nil
	}

	return &canonicalTriggerTimer{
		Type:           timer.Type,
		Name:           timer.Name,
		DurationMs:     timer.DurationMs,
		StartBehavior:  timer.StartBehavior,
		WarningSeconds: timer.WarningSeconds,
		WarningAction:  getTimerActionHashContent(timer.WarningAction),
		EndedAction:    getTimerActionHashContent(timer.EndedAction),
		EarlyEnders:    cloneEarlyEnders(timer.EarlyEnders),
	}
}

func getTimerActionHashContent(action *TimerAction) *canonicalTimerAction {
	if action == nil {
		return nil
	}

	return &canonicalTimerAction{
		Display: getTextActionHashContent(action.Display),
		Speech:  getSpeechActionHashContent(action.Speech),
	}
}

func getTextActionHashContent(action TextAction) canonicalTextAction {
	return canonicalTextAction{
		Enabled: action.Enabled,
		Text:    action.Text,
	}
}

func getClipboardActionHashContent(action ClipboardAction) canonicalTextAction {
	return canonicalTextAction{
		Enabled: action.Enabled,
		Text:    action.Text,
	}
}

func getSpeechActionHashContent(action SpeechAction) canonicalSpeechAction {
	return canonicalSpeechAction{
		Enabled:   action.Enabled,
		Text:      action.Text,
		Interrupt: action.Interrupt,
	}
}

func cloneStringSlice(values []string) []string {
	if values == nil {
		return nil
	}

	return append([]string{}, values...)
}

func cloneEarlyEnders(values []TimerEarlyEnder) []TimerEarlyEnder {
	if values == nil {
		return nil
	}

	return append([]TimerEarlyEnder{}, values...)
}
