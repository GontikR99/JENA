package worldwidepresenceservice

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
)

const (
	defaultPresenceTTL     = time.Minute
	defaultCleanupInterval = 10 * time.Second
	presenceSourceEndpoint = "character-presence.characters"
)

type Options struct {
	CleanupInterval time.Duration
	Logger          logging.Logger
	Now             func() time.Time
	PresenceTTL     time.Duration
}

type Service struct {
	bus             *eventbus.Bus
	cleanupInterval time.Duration
	logger          logging.Logger
	mu              sync.Mutex
	now             func() time.Time
	presenceTTL     time.Duration
	records         map[presenceKey]presenceRecord
	stop            chan struct{}
	unlisten        func()
}

type CharacterPresenceMessage struct {
	Characters []CharacterPresence `json:"characters"`
}

type CharacterPresence struct {
	Active        bool   `json:"active"`
	CharacterName string `json:"characterName"`
	ServerName    string `json:"serverName"`
	Zone          string `json:"zone"`
}

type presenceKey struct {
	CharacterName string
	ServerName    string
}

type presenceRecord struct {
	Character       CharacterPresence
	LastSeen        time.Time
	WebsocketSource string
}

func New(bus *eventbus.Bus, logger logging.Logger) *Service {
	return NewWithOptions(bus, Options{
		Logger: logger,
	})
}

func NewWithOptions(bus *eventbus.Bus, options Options) *Service {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	logger := options.Logger
	if logger == nil {
		logger = logging.NewNop()
	}

	service := &Service{
		bus:             bus,
		cleanupInterval: defaultDuration(options.CleanupInterval, defaultCleanupInterval),
		logger:          logger,
		now:             now,
		presenceTTL:     defaultDuration(options.PresenceTTL, defaultPresenceTTL),
		records:         make(map[presenceKey]presenceRecord),
		stop:            make(chan struct{}),
	}

	service.unlisten = bus.Listen(presenceSourceEndpoint, service.handlePresenceMessage)
	go service.runCleanupLoop()

	return service
}

func (service *Service) Dispose() {
	if service.unlisten != nil {
		service.unlisten()
	}

	close(service.stop)
}

func (service *Service) handlePresenceMessage(ctx context.Context, envelope eventbus.Envelope) {
	if envelope.Source == nil {
		return
	}

	websocketSource, ok := getWebsocketSource(*envelope.Source)
	if !ok {
		return
	}

	var message CharacterPresenceMessage
	if err := json.Unmarshal(envelope.Payload, &message); err != nil {
		service.logger.Warn(
			ctx,
			"invalid character presence message",
			logging.Error(err),
		)
		return
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	now := service.now()
	service.expireStaleLocked(now)
	service.applyPresenceMessageLocked(websocketSource, message, now)
}

func (service *Service) applyPresenceMessageLocked(websocketSource string, message CharacterPresenceMessage, now time.Time) {
	currentKeysForSource := make(map[presenceKey]struct{})

	for _, character := range message.Characters {
		key := getPresenceKey(character)

		if isPresenceDelete(character) {
			if _, exists := service.records[key]; exists {
				delete(service.records, key)
			}
			continue
		}

		currentKeysForSource[key] = struct{}{}

		nextRecord := presenceRecord{
			Character:       character,
			LastSeen:        now,
			WebsocketSource: websocketSource,
		}

		service.records[key] = nextRecord
	}

	for key, record := range service.records {
		if record.WebsocketSource != websocketSource {
			continue
		}

		if _, ok := currentKeysForSource[key]; ok {
			continue
		}

		delete(service.records, key)
	}
}

func (service *Service) runCleanupLoop() {
	ticker := time.NewTicker(service.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-service.stop:
			return
		case <-ticker.C:
			service.mu.Lock()
			service.expireStaleLocked(service.now())
			service.mu.Unlock()
		}
	}
}

func (service *Service) expireStaleLocked(now time.Time) {
	for key, record := range service.records {
		if now.Sub(record.LastSeen) <= service.presenceTTL {
			continue
		}

		delete(service.records, key)
	}
}

func getWebsocketSource(source string) (string, bool) {
	if !strings.HasPrefix(source, "ws.") {
		return "", false
	}

	parts := strings.SplitN(source, ".", 3)
	if len(parts) < 2 {
		return "", false
	}

	return parts[0] + "." + parts[1], true
}

func getPresenceKey(character CharacterPresence) presenceKey {
	return presenceKey{
		CharacterName: strings.ToLower(character.CharacterName),
		ServerName:    strings.ToLower(character.ServerName),
	}
}

func isPresenceDelete(character CharacterPresence) bool {
	return !character.Active || strings.TrimSpace(character.Zone) == ""
}

func defaultDuration(value time.Duration, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}

	return fallback
}
