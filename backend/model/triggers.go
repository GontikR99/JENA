package model

type TriggerID string

type TriggerMatcher struct {
	Text    string `json:"text"`
	IsRegex bool   `json:"isRegex"`
}

type TimerEarlyEnder struct {
	Text    string `json:"text"`
	IsRegex bool   `json:"isRegex"`
}

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

type CharacterServer struct {
	CharacterName string `json:"characterName"`
	ServerName    string `json:"serverName"`
}

type ExtendedTrigger struct {
	TriggerID  TriggerID         `json:"triggerId"`
	EnabledFor []CharacterServer `json:"enabledFor"`
	Publish    bool              `json:"publish"`
	Broadcast  bool              `json:"broadcast"`
}

type ResolvedTrigger struct {
	Trigger    Trigger           `json:"trigger"`
	EnabledFor []CharacterServer `json:"enabledFor"`
	Publish    bool              `json:"publish"`
	Broadcast  bool              `json:"broadcast"`
}

type TriggerEnablementChange struct {
	TriggerID TriggerID       `json:"triggerId"`
	Character CharacterServer `json:"character"`
	Enabled   bool            `json:"enabled"`
}

type TriggerFlagChange struct {
	TriggerID TriggerID `json:"triggerId"`
	Publish   *bool     `json:"publish,omitempty"`
	Broadcast *bool     `json:"broadcast,omitempty"`
}

type TriggerUpsert struct {
	Trigger    Trigger           `json:"trigger"`
	EnabledFor []CharacterServer `json:"enabledFor,omitempty"`
}

type UserTriggerUpdate struct {
	DeletedTriggerIDs []TriggerID       `json:"deletedTriggerIds"`
	Revision          string            `json:"revision"`
	UpsertedRecords   []ExtendedTrigger `json:"upsertedRecords"`
	UpsertedTriggers  []Trigger         `json:"upsertedTriggers"`
}
