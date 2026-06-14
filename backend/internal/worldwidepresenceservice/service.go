package worldwidepresenceservice

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"jena/backend/internal/eventbus"
)

const (
	defaultPresenceTTL           = time.Minute
	defaultNotifyDebounce        = 5 * time.Second
	defaultCleanupInterval       = 10 * time.Second
	defaultFullBroadcastInterval = 30 * time.Second
	presenceSourceEndpoint       = "character-presence.characters"
	nearbyPresenceEndpoint       = "worldwide-presence.nearby-characters"
	worldwidePresenceSource      = "worldwide-presence"
)

type Options struct {
	CleanupInterval       time.Duration
	FullBroadcastInterval time.Duration
	NotifyDebounce        time.Duration
	Now                   func() time.Time
	PresenceTTL           time.Duration
}

type Service struct {
	bus                   *eventbus.Bus
	cleanupInterval       time.Duration
	fullBroadcastInterval time.Duration
	mu                    sync.Mutex
	notifyDebounce        time.Duration
	now                   func() time.Time
	presenceTTL           time.Duration
	records               map[presenceKey]presenceRecord
	unlisten              func()

	changedZones map[zoneKey]struct{}
	notifyTimer  *time.Timer
	stop         chan struct{}
}

type CharacterPresenceMessage struct {
	Characters []CharacterPresence `json:"characters"`
}

type NearbyPresenceMessage struct {
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

type zoneKey struct {
	ServerName string
	Zone       string
}

type presenceRecord struct {
	Character       CharacterPresence
	LastSeen        time.Time
	WebsocketSource string
}

func New(bus *eventbus.Bus) *Service {
	return NewWithOptions(bus, Options{})
}

func NewWithOptions(bus *eventbus.Bus, options Options) *Service {
	now := options.Now
	if now == nil {
		now = time.Now
	}

	service := &Service{
		bus:                   bus,
		cleanupInterval:       defaultDuration(options.CleanupInterval, defaultCleanupInterval),
		changedZones:          make(map[zoneKey]struct{}),
		fullBroadcastInterval: defaultDuration(options.FullBroadcastInterval, defaultFullBroadcastInterval),
		notifyDebounce:        defaultDuration(options.NotifyDebounce, defaultNotifyDebounce),
		now:                   now,
		presenceTTL:           defaultDuration(options.PresenceTTL, defaultPresenceTTL),
		records:               make(map[presenceKey]presenceRecord),
		stop:                  make(chan struct{}),
	}

	service.unlisten = bus.Listen(presenceSourceEndpoint, service.handlePresenceMessage)
	go service.runCleanupLoop()
	go service.runFullBroadcastLoop()

	return service
}

func (service *Service) Dispose() {
	if service.unlisten != nil {
		service.unlisten()
	}

	close(service.stop)

	service.mu.Lock()
	defer service.mu.Unlock()

	if service.notifyTimer != nil {
		service.notifyTimer.Stop()
		service.notifyTimer = nil
	}
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
		slog.Warn("invalid character presence message", "error", err)
		return
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	now := service.now()
	service.expireStaleLocked(now)
	service.applyPresenceMessageLocked(websocketSource, message, now)
	service.scheduleNotifyLocked()
}

func (service *Service) applyPresenceMessageLocked(websocketSource string, message CharacterPresenceMessage, now time.Time) {
	currentKeysForSource := make(map[presenceKey]struct{})

	for _, character := range message.Characters {
		key := getPresenceKey(character)

		if isPresenceDelete(character) {
			existingRecord, exists := service.records[key]
			if exists {
				delete(service.records, key)
				service.markChangedZoneLocked(getZoneKey(existingRecord.Character))
			}
			continue
		}

		currentKeysForSource[key] = struct{}{}

		nextRecord := presenceRecord{
			Character:       character,
			LastSeen:        now,
			WebsocketSource: websocketSource,
		}

		existingRecord, exists := service.records[key]
		if !exists || !recordsEqual(existingRecord, nextRecord) {
			if exists {
				service.markChangedZoneLocked(getZoneKey(existingRecord.Character))
			}
			service.markChangedZoneLocked(getZoneKey(nextRecord.Character))
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
		service.markChangedZoneLocked(getZoneKey(record.Character))
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
			removed := service.expireStaleLocked(service.now())
			if removed {
				service.scheduleNotifyLocked()
			}
			service.mu.Unlock()
		}
	}
}

func (service *Service) runFullBroadcastLoop() {
	ticker := time.NewTicker(service.fullBroadcastInterval)
	defer ticker.Stop()

	for {
		select {
		case <-service.stop:
			return
		case <-ticker.C:
			service.sendAllNearbyPresence(context.Background())
		}
	}
}

func (service *Service) expireStaleLocked(now time.Time) bool {
	removed := false

	for key, record := range service.records {
		if now.Sub(record.LastSeen) <= service.presenceTTL {
			continue
		}

		delete(service.records, key)
		service.markChangedZoneLocked(getZoneKey(record.Character))
		removed = true
	}

	return removed
}

func (service *Service) markChangedZoneLocked(zone zoneKey) {
	service.changedZones[zone] = struct{}{}
}

func (service *Service) scheduleNotifyLocked() {
	if len(service.changedZones) == 0 || service.notifyTimer != nil {
		return
	}

	service.notifyTimer = time.AfterFunc(service.notifyDebounce, func() {
		service.sendNearbyPresence(context.Background())
	})
}

func (service *Service) sendNearbyPresence(ctx context.Context) {
	service.mu.Lock()
	changedZones := service.changedZones
	service.changedZones = make(map[zoneKey]struct{})
	service.notifyTimer = nil

	recordsByZone := service.getRecordsByZoneLocked()
	recordsBySource := service.getRecordsBySourceLocked()
	messages := service.getNearbyMessagesLocked(changedZones, recordsByZone, recordsBySource)
	service.mu.Unlock()

	service.sendNearbyMessages(ctx, messages)
}

func (service *Service) sendAllNearbyPresence(ctx context.Context) {
	service.mu.Lock()
	recordsByZone := service.getRecordsByZoneLocked()
	recordsBySource := service.getRecordsBySourceLocked()
	allZones := make(map[zoneKey]struct{}, len(recordsByZone))
	for zone := range recordsByZone {
		allZones[zone] = struct{}{}
	}
	messages := service.getNearbyMessagesLocked(allZones, recordsByZone, recordsBySource)
	service.mu.Unlock()

	service.sendNearbyMessages(ctx, messages)
}

func (service *Service) sendNearbyMessages(ctx context.Context, messages map[string]NearbyPresenceMessage) {
	source := worldwidePresenceSource
	for websocketSource, message := range messages {
		payload, err := json.Marshal(message)
		if err != nil {
			slog.Warn("failed to marshal nearby presence message", "error", err)
			continue
		}

		if err := service.bus.Send(ctx, eventbus.Envelope{
			Destination: websocketSource + "." + nearbyPresenceEndpoint,
			Payload:     payload,
			Source:      &source,
		}); err != nil {
			slog.Warn("failed to send nearby presence message", "error", err)
		}
	}
}

func (service *Service) getRecordsByZoneLocked() map[zoneKey][]CharacterPresence {
	recordsByZone := make(map[zoneKey][]CharacterPresence)

	for _, record := range service.records {
		zone := getZoneKey(record.Character)
		recordsByZone[zone] = append(recordsByZone[zone], record.Character)
	}

	return recordsByZone
}

func (service *Service) getRecordsBySourceLocked() map[string][]presenceRecord {
	recordsBySource := make(map[string][]presenceRecord)

	for _, record := range service.records {
		recordsBySource[record.WebsocketSource] = append(
			recordsBySource[record.WebsocketSource],
			record,
		)
	}

	return recordsBySource
}

func (service *Service) getNearbyMessagesLocked(
	changedZones map[zoneKey]struct{},
	recordsByZone map[zoneKey][]CharacterPresence,
	recordsBySource map[string][]presenceRecord,
) map[string]NearbyPresenceMessage {
	messages := make(map[string]NearbyPresenceMessage)

	for websocketSource, sourceRecords := range recordsBySource {
		sourceTouchesChangedZone := false
		nearbyByKey := make(map[presenceKey]CharacterPresence)

		for _, sourceRecord := range sourceRecords {
			zone := getZoneKey(sourceRecord.Character)
			if _, ok := changedZones[zone]; ok {
				sourceTouchesChangedZone = true
			}

			for _, nearbyCharacter := range recordsByZone[zone] {
				nearbyByKey[getPresenceKey(nearbyCharacter)] = nearbyCharacter
			}
		}

		if !sourceTouchesChangedZone {
			continue
		}

		messages[websocketSource] = NearbyPresenceMessage{
			Characters: sortCharacters(nearbyByKey),
		}
	}

	return messages
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

func getZoneKey(character CharacterPresence) zoneKey {
	return zoneKey{
		ServerName: strings.ToLower(character.ServerName),
		Zone:       strings.ToLower(character.Zone),
	}
}

func isPresenceDelete(character CharacterPresence) bool {
	return !character.Active || strings.TrimSpace(character.Zone) == ""
}

func recordsEqual(left presenceRecord, right presenceRecord) bool {
	return left.Character == right.Character &&
		left.WebsocketSource == right.WebsocketSource
}

func defaultDuration(value time.Duration, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}

	return fallback
}

func sortCharacters(characters map[presenceKey]CharacterPresence) []CharacterPresence {
	keys := make([]presenceKey, 0, len(characters))
	for key := range characters {
		keys = append(keys, key)
	}

	sortPresenceKeys(keys)

	result := make([]CharacterPresence, 0, len(keys))
	for _, key := range keys {
		result = append(result, characters[key])
	}

	return result
}

func sortPresenceKeys(keys []presenceKey) {
	for i := 1; i < len(keys); i++ {
		key := keys[i]
		j := i - 1

		for j >= 0 && comparePresenceKeys(keys[j], key) > 0 {
			keys[j+1] = keys[j]
			j--
		}

		keys[j+1] = key
	}
}

func comparePresenceKeys(left presenceKey, right presenceKey) int {
	if left.ServerName < right.ServerName {
		return -1
	}
	if left.ServerName > right.ServerName {
		return 1
	}
	if left.CharacterName < right.CharacterName {
		return -1
	}
	if left.CharacterName > right.CharacterName {
		return 1
	}

	return 0
}
