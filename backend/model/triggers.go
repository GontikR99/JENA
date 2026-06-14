package model

type TriggerID string
type TriggerMatcher string
type TimerEarlyEnder string

type TriggerTimerType string

const (
	TriggerTimerTypeCountdown TriggerTimerType = "countdown"
	TriggerTimerTypeRepeating TriggerTimerType = "repeating"
	TriggerTimerTypeStopwatch TriggerTimerType = "stopwatch"
)

type TimerStartBehavior string

const (
	TimerStartBehaviorStartNew                 TimerStartBehavior = "startNew"
	TimerStartBehaviorRestart                  TimerStartBehavior = "restart"
	TimerStartBehaviorRestartMatchingTimerName TimerStartBehavior = "restartMatchingTimerName"
	TimerStartBehaviorIgnoreIfRunning          TimerStartBehavior = "ignoreIfRunning"
)

type Trigger struct {
	ID        TriggerID      `json:"id"`
	Name      string         `json:"name"`
	Author    string         `json:"author"`
	Comments  string         `json:"comments"`
	Category  string         `json:"category"`
	GroupPath []string       `json:"groupPath"`
	Match     TriggerMatcher `json:"match"`
	Actions   TriggerActions `json:"actions"`
	Timer     *TriggerTimer  `json:"timer"`
}

type TriggerActions struct {
	Display   TextAction      `json:"display"`
	Speech    SpeechAction    `json:"speech"`
	Clipboard ClipboardAction `json:"clipboard"`
}

type TextAction struct {
	Enabled bool   `json:"enabled"`
	Text    string `json:"text"`
}

type SpeechAction struct {
	Enabled   bool   `json:"enabled"`
	Text      string `json:"text"`
	Interrupt bool   `json:"interrupt"`
}

type ClipboardAction struct {
	Enabled bool   `json:"enabled"`
	Text    string `json:"text"`
}

type TriggerTimer struct {
	Type           TriggerTimerType   `json:"type"`
	Name           string             `json:"name"`
	DurationMs     int64              `json:"durationMs"`
	StartBehavior  TimerStartBehavior `json:"startBehavior"`
	WarningSeconds int64              `json:"warningSeconds"`
	WarningAction  *TimerAction       `json:"warningAction"`
	EndedAction    *TimerAction       `json:"endedAction"`
	EarlyEnders    []TimerEarlyEnder  `json:"earlyEnders"`
}

type TimerAction struct {
	Display TextAction   `json:"display"`
	Speech  SpeechAction `json:"speech"`
}
