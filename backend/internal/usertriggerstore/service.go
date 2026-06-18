package usertriggerstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/identityservice"
	"jena/backend/internal/logging"
	"jena/backend/internal/triggerstore"
	"jena/backend/model"
)

const endpoint = "user-trigger-store"

type Service struct {
	bus          *eventbus.Bus
	db           *database.Database
	identity     *identityservice.Service
	logger       logging.Logger
	triggerStore *triggerstore.Service
	unregister   func()
}

type FetchTriggersResponse struct {
	Records  []model.ExtendedTrigger `json:"records"`
	Revision string                  `json:"revision"`
}

type UpsertTriggersRequest struct {
	DeleteTriggerIDs []model.TriggerID     `json:"deleteTriggerIds,omitempty"`
	KnownRevision    string                `json:"knownRevision,omitempty"`
	Triggers         []model.TriggerUpsert `json:"triggers"`
}

type DeleteTriggersRequest struct {
	KnownRevision string            `json:"knownRevision,omitempty"`
	TriggerIDs    []model.TriggerID `json:"triggerIds"`
}

type ToggleTriggersRequest struct {
	Changes       []model.TriggerEnablementChange `json:"changes"`
	KnownRevision string                          `json:"knownRevision,omitempty"`
}

type SetTriggerFlagsRequest struct {
	Changes       []model.TriggerFlagChange `json:"changes"`
	KnownRevision string                    `json:"knownRevision,omitempty"`
}

type PingRequest struct {
	KnownRevision string `json:"knownRevision,omitempty"`
}

type PingResponse struct {
	Revision string `json:"revision"`
}

func New(
	ctx context.Context,
	bus *eventbus.Bus,
	db *database.Database,
	identity *identityservice.Service,
	triggerStore *triggerstore.Service,
	logger logging.Logger,
) (*Service, error) {
	if logger == nil {
		logger = logging.NewNop()
	}

	service := &Service{
		bus:          bus,
		db:           db,
		identity:     identity,
		logger:       logger,
		triggerStore: triggerStore,
	}

	if err := service.migrate(ctx); err != nil {
		return nil, err
	}

	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"deleteTriggers":  service.deleteTriggers,
		"fetchTriggers":   service.fetchTriggers,
		"ping":            service.ping,
		"setTriggerFlags": service.setTriggerFlags,
		"toggleTriggers":  service.toggleTriggers,
		"upsertTriggers":  service.upsertTriggers,
	})

	return service, nil
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (service *Service) migrate(ctx context.Context) error {
	if _, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS user_triggers (
			user_id TEXT NOT NULL,
			trigger_id TEXT NOT NULL,
			deleted INTEGER NOT NULL,
			publish INTEGER NOT NULL DEFAULT 0,
			broadcast_mode TEXT NOT NULL DEFAULT 'private',
			updated_at_ms INTEGER NOT NULL,
			PRIMARY KEY (user_id, trigger_id),
			FOREIGN KEY (trigger_id) REFERENCES triggers(id)
		)
	`); err != nil {
		return fmt.Errorf("migrate user triggers: %w", err)
	}

	if _, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS user_trigger_enabled_for (
			user_id TEXT NOT NULL,
			trigger_id TEXT NOT NULL,
			character_name TEXT NOT NULL,
			server_name TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL,
			PRIMARY KEY (user_id, trigger_id, character_name, server_name)
		)
	`); err != nil {
		return fmt.Errorf("migrate user trigger enabled-for rows: %w", err)
	}

	if _, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS user_trigger_revisions (
			user_id TEXT PRIMARY KEY,
			revision TEXT NOT NULL,
			updated_at_ms INTEGER NOT NULL
		)
	`); err != nil {
		return fmt.Errorf("migrate user trigger revisions: %w", err)
	}

	return nil
}

func (service *Service) fetchTriggers(ctx context.Context, metadata eventbus.RPCMetadata, _ json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	return service.fetchState(ctx, userID)
}

func (service *Service) upsertTriggers(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request UpsertTriggersRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode upsert triggers request: %w", err)
	}

	update, err := service.applyUpsert(ctx, userID, request)
	if err != nil {
		return nil, err
	}

	service.broadcastUpdate(ctx, userID, update)
	return update, nil
}

func (service *Service) deleteTriggers(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request DeleteTriggersRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode delete triggers request: %w", err)
	}

	update, err := service.applyDelete(ctx, userID, request.TriggerIDs)
	if err != nil {
		return nil, err
	}

	service.broadcastUpdate(ctx, userID, update)
	return update, nil
}

func (service *Service) toggleTriggers(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request ToggleTriggersRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode toggle triggers request: %w", err)
	}

	update, err := service.applyToggle(ctx, userID, request.Changes)
	if err != nil {
		return nil, err
	}

	service.broadcastUpdate(ctx, userID, update)
	return update, nil
}

func (service *Service) setTriggerFlags(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request SetTriggerFlagsRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode set trigger flags request: %w", err)
	}

	update, err := service.applyFlagChanges(ctx, userID, request.Changes)
	if err != nil {
		return nil, err
	}

	service.broadcastUpdate(ctx, userID, update)
	return update, nil
}

func (service *Service) ping(ctx context.Context, metadata eventbus.RPCMetadata, _ json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	revision, err := service.getOrCreateRevision(ctx, userID)
	if err != nil {
		return nil, err
	}

	return PingResponse{Revision: revision}, nil
}

func (service *Service) authenticate(ctx context.Context, metadata eventbus.RPCMetadata) (string, error) {
	userID, err := service.identity.StableIDForAuthToken(ctx, &metadata.AuthToken)
	if err != nil {
		return "", err
	}

	return userID, nil
}

func (service *Service) broadcastUpdate(ctx context.Context, userID string, update model.UserTriggerUpdate) {
	payload, err := json.Marshal(update)
	if err != nil {
		return
	}

	source := endpoint
	_ = service.bus.Send(ctx, eventbus.Envelope{
		Destination: "user." + userID + ".user-trigger-store.updated",
		Payload:     payload,
		Source:      &source,
	})
}

func (service *Service) applyUpsert(ctx context.Context, userID string, request UpsertTriggersRequest) (model.UserTriggerUpdate, error) {
	startedAt := time.Now()
	updatedAtMs := time.Now().UnixMilli()
	canonicalUpserts := make([]model.TriggerUpsert, 0, len(request.Triggers))
	upsertedTriggers := make([]model.Trigger, 0, len(request.Triggers))
	deleteIDs := make(map[model.TriggerID]struct{})
	copySourcesByTriggerID := make(map[model.TriggerID][]model.TriggerID)
	explicitDeleteIDs := make([]model.TriggerID, 0, len(request.DeleteTriggerIDs))

	for _, triggerID := range request.DeleteTriggerIDs {
		if triggerID != "" {
			deleteIDs[triggerID] = struct{}{}
			explicitDeleteIDs = append(explicitDeleteIDs, triggerID)
		}
	}

	preparationStartedAt := time.Now()
	for _, upsert := range request.Triggers {
		canonicalTrigger, err := service.triggerStore.StoreTrigger(ctx, upsert.Trigger)
		if err != nil {
			return model.UserTriggerUpdate{}, err
		}

		implicitDeleteIDs, err := service.findPathNameMatches(ctx, userID, canonicalTrigger)
		if err != nil {
			return model.UserTriggerUpdate{}, err
		}
		for _, triggerID := range implicitDeleteIDs {
			if triggerID != canonicalTrigger.ID {
				deleteIDs[triggerID] = struct{}{}
				copySourcesByTriggerID[canonicalTrigger.ID] = append(copySourcesByTriggerID[canonicalTrigger.ID], triggerID)
			}
		}

		enabledFor, err := normalizeEnabledFor(upsert.EnabledFor)
		if err != nil {
			return model.UserTriggerUpdate{}, err
		}

		canonicalUpserts = append(canonicalUpserts, model.TriggerUpsert{
			Trigger:    canonicalTrigger,
			EnabledFor: enabledFor,
		})
		upsertedTriggers = append(upsertedTriggers, canonicalTrigger)
		delete(deleteIDs, canonicalTrigger.ID)
	}
	service.logger.Debug(
		ctx,
		"user trigger upsert preparation completed",
		logging.Int("requestTriggerCount", len(request.Triggers)),
		logging.Int("preparedTriggerCount", len(canonicalUpserts)),
		logging.Int("deleteTriggerCount", len(deleteIDs)),
		logging.Int64("durationMs", time.Since(preparationStartedAt).Milliseconds()),
	)
	if len(canonicalUpserts) == 1 {
		copySourcesByTriggerID[canonicalUpserts[0].Trigger.ID] = append(
			copySourcesByTriggerID[canonicalUpserts[0].Trigger.ID],
			explicitDeleteIDs...,
		)
	}

	tx, err := service.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("begin user trigger upsert: %w", err)
	}
	defer tx.Rollback()

	transactionStartedAt := time.Now()
	tombstoneCount := 0
	var tombstoneDuration time.Duration
	for triggerID := range deleteIDs {
		operationStartedAt := time.Now()
		if err := tombstoneTrigger(ctx, tx, userID, triggerID, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		tombstoneDuration += time.Since(operationStartedAt)
		tombstoneCount += 1
	}

	userTriggerUpsertCount := 0
	copiedEnabledForCount := 0
	copiedFlagCount := 0
	enabledForCount := 0
	var userTriggerUpsertDuration time.Duration
	var copiedEnabledForDuration time.Duration
	var copiedFlagDuration time.Duration
	var enabledForDuration time.Duration
	for _, upsert := range canonicalUpserts {
		operationStartedAt := time.Now()
		if err := upsertUserTrigger(ctx, tx, userID, upsert.Trigger.ID, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		userTriggerUpsertDuration += time.Since(operationStartedAt)
		userTriggerUpsertCount += 1

		for _, deleteID := range copySourcesByTriggerID[upsert.Trigger.ID] {
			operationStartedAt := time.Now()
			if err := copyEnabledFor(ctx, tx, userID, deleteID, upsert.Trigger.ID, updatedAtMs); err != nil {
				return model.UserTriggerUpdate{}, err
			}
			copiedEnabledForDuration += time.Since(operationStartedAt)
			copiedEnabledForCount += 1
		}
		operationStartedAt = time.Now()
		if err := copyTriggerFlags(ctx, tx, userID, copySourcesByTriggerID[upsert.Trigger.ID], upsert.Trigger.ID, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		copiedFlagDuration += time.Since(operationStartedAt)
		if len(copySourcesByTriggerID[upsert.Trigger.ID]) > 0 {
			copiedFlagCount += 1
		}

		for _, enabledFor := range upsert.EnabledFor {
			operationStartedAt := time.Now()
			if err := setEnabledFor(ctx, tx, userID, upsert.Trigger.ID, enabledFor, true, updatedAtMs); err != nil {
				return model.UserTriggerUpdate{}, err
			}
			enabledForDuration += time.Since(operationStartedAt)
			enabledForCount += 1
		}
	}

	revisionStartedAt := time.Now()
	revision, err := bumpRevision(ctx, tx, userID, updatedAtMs)
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}
	revisionDuration := time.Since(revisionStartedAt)

	commitStartedAt := time.Now()
	if err := tx.Commit(); err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("commit user trigger upsert: %w", err)
	}
	commitDuration := time.Since(commitStartedAt)
	service.logger.Debug(
		ctx,
		"user trigger upsert transaction completed",
		logging.Int("triggerCount", len(canonicalUpserts)),
		logging.Int("tombstoneCount", tombstoneCount),
		logging.Int("userTriggerUpsertCount", userTriggerUpsertCount),
		logging.Int("copiedEnabledForCount", copiedEnabledForCount),
		logging.Int("copiedFlagCount", copiedFlagCount),
		logging.Int("enabledForCount", enabledForCount),
		logging.Int64("tombstoneDurationMs", tombstoneDuration.Milliseconds()),
		logging.Int64("userTriggerUpsertDurationMs", userTriggerUpsertDuration.Milliseconds()),
		logging.Int64("copiedEnabledForDurationMs", copiedEnabledForDuration.Milliseconds()),
		logging.Int64("copiedFlagDurationMs", copiedFlagDuration.Milliseconds()),
		logging.Int64("enabledForDurationMs", enabledForDuration.Milliseconds()),
		logging.Int64("revisionDurationMs", revisionDuration.Milliseconds()),
		logging.Int64("commitDurationMs", commitDuration.Milliseconds()),
		logging.Int64("durationMs", time.Since(transactionStartedAt).Milliseconds()),
	)

	fetchStartedAt := time.Now()
	records, err := service.fetchRecordsForIDs(ctx, userID, getTriggerIDs(upsertedTriggers))
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}
	service.logger.Debug(
		ctx,
		"user trigger upsert records fetched",
		logging.Int("recordCount", len(records)),
		logging.Int64("durationMs", time.Since(fetchStartedAt).Milliseconds()),
	)
	service.logger.Debug(
		ctx,
		"user trigger upsert completed",
		logging.Int("requestTriggerCount", len(request.Triggers)),
		logging.Int("upsertedTriggerCount", len(upsertedTriggers)),
		logging.Int("deletedTriggerCount", len(deleteIDs)),
		logging.Int64("durationMs", time.Since(startedAt).Milliseconds()),
	)

	return model.UserTriggerUpdate{
		DeletedTriggerIDs: mapKeys(deleteIDs),
		Revision:          revision,
		UpsertedRecords:   records,
		UpsertedTriggers:  upsertedTriggers,
	}, nil
}

func (service *Service) applyDelete(ctx context.Context, userID string, triggerIDs []model.TriggerID) (model.UserTriggerUpdate, error) {
	updatedAtMs := time.Now().UnixMilli()
	deleteIDs := make(map[model.TriggerID]struct{}, len(triggerIDs))
	for _, triggerID := range triggerIDs {
		if triggerID != "" {
			deleteIDs[triggerID] = struct{}{}
		}
	}

	tx, err := service.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("begin user trigger delete: %w", err)
	}
	defer tx.Rollback()

	for triggerID := range deleteIDs {
		if err := tombstoneTrigger(ctx, tx, userID, triggerID, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
	}

	revision, err := bumpRevision(ctx, tx, userID, updatedAtMs)
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}

	if err := tx.Commit(); err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("commit user trigger delete: %w", err)
	}

	return model.UserTriggerUpdate{
		DeletedTriggerIDs: mapKeys(deleteIDs),
		Revision:          revision,
		UpsertedRecords:   []model.ExtendedTrigger{},
		UpsertedTriggers:  []model.Trigger{},
	}, nil
}

func (service *Service) applyToggle(ctx context.Context, userID string, changes []model.TriggerEnablementChange) (model.UserTriggerUpdate, error) {
	updatedAtMs := time.Now().UnixMilli()
	changedIDs := make(map[model.TriggerID]struct{}, len(changes))

	tx, err := service.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("begin user trigger toggle: %w", err)
	}
	defer tx.Rollback()

	for _, change := range changes {
		if change.TriggerID == "" {
			return model.UserTriggerUpdate{}, errors.New("trigger id is required")
		}
		if err := validateCharacterServer(change.Character); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		if err := upsertUserTrigger(ctx, tx, userID, change.TriggerID, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		if err := setEnabledFor(ctx, tx, userID, change.TriggerID, change.Character, change.Enabled, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		changedIDs[change.TriggerID] = struct{}{}
	}

	revision, err := bumpRevision(ctx, tx, userID, updatedAtMs)
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}

	if err := tx.Commit(); err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("commit user trigger toggle: %w", err)
	}

	records, err := service.fetchRecordsForIDs(ctx, userID, mapKeys(changedIDs))
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}
	triggers, err := service.fetchTriggersForIDs(ctx, mapKeys(changedIDs))
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}

	return model.UserTriggerUpdate{
		DeletedTriggerIDs: []model.TriggerID{},
		Revision:          revision,
		UpsertedRecords:   records,
		UpsertedTriggers:  triggers,
	}, nil
}

func (service *Service) applyFlagChanges(ctx context.Context, userID string, changes []model.TriggerFlagChange) (model.UserTriggerUpdate, error) {
	updatedAtMs := time.Now().UnixMilli()
	changedIDs := make(map[model.TriggerID]struct{}, len(changes))

	tx, err := service.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("begin user trigger flag update: %w", err)
	}
	defer tx.Rollback()

	for _, change := range changes {
		if change.TriggerID == "" {
			return model.UserTriggerUpdate{}, errors.New("trigger id is required")
		}
		if change.Publish == nil && change.BroadcastMode == nil {
			continue
		}
		if change.BroadcastMode != nil {
			if err := validateBroadcastMode(*change.BroadcastMode); err != nil {
				return model.UserTriggerUpdate{}, err
			}
		}
		if err := upsertUserTrigger(ctx, tx, userID, change.TriggerID, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		if err := setTriggerFlags(ctx, tx, userID, change, updatedAtMs); err != nil {
			return model.UserTriggerUpdate{}, err
		}
		changedIDs[change.TriggerID] = struct{}{}
	}

	revision, err := bumpRevision(ctx, tx, userID, updatedAtMs)
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}

	if err := tx.Commit(); err != nil {
		return model.UserTriggerUpdate{}, fmt.Errorf("commit user trigger flag update: %w", err)
	}

	records, err := service.fetchRecordsForIDs(ctx, userID, mapKeys(changedIDs))
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}
	triggers, err := service.fetchTriggersForIDs(ctx, mapKeys(changedIDs))
	if err != nil {
		return model.UserTriggerUpdate{}, err
	}

	return model.UserTriggerUpdate{
		DeletedTriggerIDs: []model.TriggerID{},
		Revision:          revision,
		UpsertedRecords:   records,
		UpsertedTriggers:  triggers,
	}, nil
}

func (service *Service) fetchState(ctx context.Context, userID string) (FetchTriggersResponse, error) {
	rows, err := service.db.QueryContext(ctx, `
		SELECT
			ut.trigger_id,
			ut.publish,
			ut.broadcast_mode,
			ute.character_name,
			ute.server_name
		FROM user_triggers ut
		LEFT JOIN user_trigger_enabled_for ute
			ON ute.user_id = ut.user_id
			AND ute.trigger_id = ut.trigger_id
			AND ute.enabled = 1
		WHERE ut.user_id = ?
			AND ut.deleted = 0
		ORDER BY ut.updated_at_ms, ut.trigger_id, ute.character_name, ute.server_name
	`, userID)
	if err != nil {
		return FetchTriggersResponse{}, fmt.Errorf("fetch user triggers: %w", err)
	}
	defer rows.Close()

	recordsByID := make(map[model.TriggerID]*model.ExtendedTrigger)
	orderedIDs := []model.TriggerID{}

	for rows.Next() {
		var triggerID model.TriggerID
		var publish int
		var broadcastMode model.BroadcastMode
		var characterName sql.NullString
		var serverName sql.NullString

		if err := rows.Scan(&triggerID, &publish, &broadcastMode, &characterName, &serverName); err != nil {
			return FetchTriggersResponse{}, fmt.Errorf("scan user trigger: %w", err)
		}

		record, ok := recordsByID[triggerID]
		if !ok {
			recordsByID[triggerID] = &model.ExtendedTrigger{
				TriggerID:     triggerID,
				EnabledFor:    []model.CharacterServer{},
				Publish:       publish != 0,
				BroadcastMode: broadcastMode,
			}
			record = recordsByID[triggerID]
			orderedIDs = append(orderedIDs, triggerID)
		}

		if characterName.Valid && serverName.Valid {
			record.EnabledFor = append(record.EnabledFor, model.CharacterServer{
				CharacterName: characterName.String,
				ServerName:    serverName.String,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return FetchTriggersResponse{}, fmt.Errorf("fetch user trigger rows: %w", err)
	}

	records := make([]model.ExtendedTrigger, 0, len(orderedIDs))
	for _, triggerID := range orderedIDs {
		records = append(records, *recordsByID[triggerID])
	}

	revision, err := service.getOrCreateRevision(ctx, userID)
	if err != nil {
		return FetchTriggersResponse{}, err
	}

	return FetchTriggersResponse{
		Records:  records,
		Revision: revision,
	}, nil
}

func (service *Service) fetchRecordsForIDs(ctx context.Context, userID string, triggerIDs []model.TriggerID) ([]model.ExtendedTrigger, error) {
	state, err := service.fetchState(ctx, userID)
	if err != nil {
		return nil, err
	}

	want := make(map[model.TriggerID]struct{}, len(triggerIDs))
	for _, triggerID := range triggerIDs {
		want[triggerID] = struct{}{}
	}

	records := make([]model.ExtendedTrigger, 0, len(triggerIDs))
	for _, record := range state.Records {
		if _, ok := want[record.TriggerID]; ok {
			records = append(records, record)
		}
	}

	return records, nil
}

func (service *Service) fetchTriggersForIDs(ctx context.Context, triggerIDs []model.TriggerID) ([]model.Trigger, error) {
	triggers := make([]model.Trigger, 0, len(triggerIDs))
	for _, triggerID := range triggerIDs {
		trigger, err := service.triggerStore.GetTrigger(ctx, triggerID)
		if err != nil {
			return nil, err
		}
		triggers = append(triggers, trigger)
	}
	return triggers, nil
}

func (service *Service) findPathNameMatches(ctx context.Context, userID string, trigger model.Trigger) ([]model.TriggerID, error) {
	pathKey, err := triggerstore.PathKey(trigger.GroupPath)
	if err != nil {
		return nil, err
	}

	rows, err := service.db.QueryContext(
		ctx,
		`
			SELECT ut.trigger_id
			FROM triggers t
			CROSS JOIN user_triggers ut
			WHERE t.path_key = ?
				AND t.name = ?
				AND t.id <> ?
				AND ut.user_id = ?
				AND ut.deleted = 0
				AND ut.trigger_id = t.id
			ORDER BY ut.trigger_id
		`,
		pathKey,
		trigger.Name,
		string(trigger.ID),
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("find trigger path/name matches: %w", err)
	}
	defer rows.Close()

	matches := []model.TriggerID{}
	for rows.Next() {
		var triggerID string
		if err := rows.Scan(&triggerID); err != nil {
			return nil, fmt.Errorf("scan trigger path/name match: %w", err)
		}
		matches = append(matches, model.TriggerID(triggerID))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate trigger path/name matches: %w", err)
	}

	return matches, nil
}

func (service *Service) getOrCreateRevision(ctx context.Context, userID string) (string, error) {
	var revision string
	if err := service.db.QueryRowContext(ctx, "SELECT revision FROM user_trigger_revisions WHERE user_id = ?", userID).Scan(&revision); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("lookup user trigger revision: %w", err)
		}

		revision = eventbus.CreateMessageID()
		if _, err := service.db.ExecContext(
			ctx,
			"INSERT INTO user_trigger_revisions (user_id, revision, updated_at_ms) VALUES (?, ?, ?)",
			userID,
			revision,
			time.Now().UnixMilli(),
		); err != nil {
			return "", fmt.Errorf("create user trigger revision: %w", err)
		}
	}

	return revision, nil
}

func tombstoneTrigger(ctx context.Context, tx *sql.Tx, userID string, triggerID model.TriggerID, updatedAtMs int64) error {
	_, err := tx.ExecContext(
		ctx,
		`
			INSERT INTO user_triggers (user_id, trigger_id, deleted, updated_at_ms)
			VALUES (?, ?, 1, ?)
			ON CONFLICT(user_id, trigger_id) DO UPDATE SET
				deleted = 1,
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		string(triggerID),
		updatedAtMs,
	)
	if err != nil {
		return fmt.Errorf("delete user trigger: %w", err)
	}
	return nil
}

func upsertUserTrigger(ctx context.Context, tx *sql.Tx, userID string, triggerID model.TriggerID, updatedAtMs int64) error {
	_, err := tx.ExecContext(
		ctx,
		`
			INSERT INTO user_triggers (user_id, trigger_id, deleted, updated_at_ms)
			VALUES (?, ?, 0, ?)
			ON CONFLICT(user_id, trigger_id) DO UPDATE SET
				deleted = 0,
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		string(triggerID),
		updatedAtMs,
	)
	if err != nil {
		return fmt.Errorf("upsert user trigger: %w", err)
	}
	return nil
}

func copyEnabledFor(ctx context.Context, tx *sql.Tx, userID string, fromTriggerID model.TriggerID, toTriggerID model.TriggerID, updatedAtMs int64) error {
	_, err := tx.ExecContext(
		ctx,
		`
			INSERT INTO user_trigger_enabled_for (
				user_id,
				trigger_id,
				character_name,
				server_name,
				enabled,
				updated_at_ms
			)
			SELECT
				user_id,
				?,
				character_name,
				server_name,
				enabled,
				?
			FROM user_trigger_enabled_for
			WHERE user_id = ?
				AND trigger_id = ?
				AND enabled = 1
			ON CONFLICT(user_id, trigger_id, character_name, server_name) DO UPDATE SET
				enabled = excluded.enabled,
				updated_at_ms = excluded.updated_at_ms
		`,
		string(toTriggerID),
		updatedAtMs,
		userID,
		string(fromTriggerID),
	)
	if err != nil {
		return fmt.Errorf("copy enabled-for rows: %w", err)
	}
	return nil
}

func copyTriggerFlags(ctx context.Context, tx *sql.Tx, userID string, fromTriggerIDs []model.TriggerID, toTriggerID model.TriggerID, updatedAtMs int64) error {
	if len(fromTriggerIDs) == 0 {
		return nil
	}

	publish := 0
	broadcastMode := model.BroadcastModePrivate
	for _, fromTriggerID := range fromTriggerIDs {
		var sourcePublish int
		var sourceBroadcastMode model.BroadcastMode
		err := tx.QueryRowContext(
			ctx,
			`
				SELECT publish, broadcast_mode
				FROM user_triggers
				WHERE user_id = ?
					AND trigger_id = ?
			`,
			userID,
			string(fromTriggerID),
		).Scan(&sourcePublish, &sourceBroadcastMode)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("lookup trigger flags: %w", err)
		}

		if sourcePublish != 0 {
			publish = 1
		}
		broadcastMode = strongestBroadcastMode(broadcastMode, sourceBroadcastMode)
	}

	_, err := tx.ExecContext(
		ctx,
		`
			UPDATE user_triggers
			SET
				publish = CASE WHEN ? = 1 THEN 1 ELSE publish END,
				broadcast_mode = CASE
					WHEN ? = 'subscribers' THEN 'subscribers'
					WHEN ? = 'boxes' AND broadcast_mode != 'subscribers' THEN 'boxes'
					ELSE broadcast_mode
				END,
				updated_at_ms = ?
			WHERE user_id = ?
				AND trigger_id = ?
		`,
		publish,
		string(broadcastMode),
		string(broadcastMode),
		updatedAtMs,
		userID,
		string(toTriggerID),
	)
	if err != nil {
		return fmt.Errorf("copy trigger flags: %w", err)
	}
	return nil
}

func setEnabledFor(ctx context.Context, tx *sql.Tx, userID string, triggerID model.TriggerID, character model.CharacterServer, enabled bool, updatedAtMs int64) error {
	if err := validateCharacterServer(character); err != nil {
		return err
	}

	enabledValue := 0
	if enabled {
		enabledValue = 1
	}

	_, err := tx.ExecContext(
		ctx,
		`
			INSERT INTO user_trigger_enabled_for (
				user_id,
				trigger_id,
				character_name,
				server_name,
				enabled,
				updated_at_ms
			)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, trigger_id, character_name, server_name) DO UPDATE SET
				enabled = excluded.enabled,
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		string(triggerID),
		character.CharacterName,
		character.ServerName,
		enabledValue,
		updatedAtMs,
	)
	if err != nil {
		return fmt.Errorf("set enabled-for row: %w", err)
	}
	return nil
}

func setTriggerFlags(ctx context.Context, tx *sql.Tx, userID string, change model.TriggerFlagChange, updatedAtMs int64) error {
	publishSQL := "publish"
	publishArg := any(nil)
	if change.Publish != nil {
		publishSQL = "?"
		if *change.Publish {
			publishArg = 1
		} else {
			publishArg = 0
		}
	}

	broadcastModeSQL := "broadcast_mode"
	broadcastModeArg := any(nil)
	if change.BroadcastMode != nil {
		broadcastModeSQL = "?"
		broadcastModeArg = string(*change.BroadcastMode)
	}

	query := fmt.Sprintf(`
		UPDATE user_triggers
		SET
			publish = %s,
			broadcast_mode = %s,
			updated_at_ms = ?
		WHERE user_id = ?
			AND trigger_id = ?
	`, publishSQL, broadcastModeSQL)

	args := []any{}
	if change.Publish != nil {
		args = append(args, publishArg)
	}
	if change.BroadcastMode != nil {
		args = append(args, broadcastModeArg)
	}
	args = append(args, updatedAtMs, userID, string(change.TriggerID))

	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("set trigger flags: %w", err)
	}
	return nil
}

func bumpRevision(ctx context.Context, tx *sql.Tx, userID string, updatedAtMs int64) (string, error) {
	revision := eventbus.CreateMessageID()
	_, err := tx.ExecContext(
		ctx,
		`
			INSERT INTO user_trigger_revisions (user_id, revision, updated_at_ms)
			VALUES (?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
				revision = excluded.revision,
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		revision,
		updatedAtMs,
	)
	if err != nil {
		return "", fmt.Errorf("bump user trigger revision: %w", err)
	}
	return revision, nil
}

func normalizeEnabledFor(values []model.CharacterServer) ([]model.CharacterServer, error) {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]model.CharacterServer, 0, len(values))

	for _, value := range values {
		if err := validateCharacterServer(value); err != nil {
			return nil, err
		}

		key := getCharacterServerKey(value)
		if _, ok := seen[key]; ok {
			continue
		}

		seen[key] = struct{}{}
		normalized = append(normalized, value)
	}

	return normalized, nil
}

func validateCharacterServer(value model.CharacterServer) error {
	if strings.TrimSpace(value.CharacterName) == "" || strings.TrimSpace(value.ServerName) == "" {
		return fmt.Errorf("enabledFor entries require characterName and serverName")
	}
	return nil
}

func validateBroadcastMode(value model.BroadcastMode) error {
	switch value {
	case model.BroadcastModePrivate,
		model.BroadcastModeBoxes,
		model.BroadcastModeSubscribers:
		return nil
	default:
		return fmt.Errorf("broadcastMode must be one of private, boxes, subscribers")
	}
}

func strongestBroadcastMode(left model.BroadcastMode, right model.BroadcastMode) model.BroadcastMode {
	if left == model.BroadcastModeSubscribers || right == model.BroadcastModeSubscribers {
		return model.BroadcastModeSubscribers
	}

	if left == model.BroadcastModeBoxes || right == model.BroadcastModeBoxes {
		return model.BroadcastModeBoxes
	}

	return model.BroadcastModePrivate
}

func getCharacterServerKey(value model.CharacterServer) string {
	return strings.ToLower(value.CharacterName) + "\x00" + strings.ToLower(value.ServerName)
}

func getTriggerIDs(triggers []model.Trigger) []model.TriggerID {
	ids := make([]model.TriggerID, 0, len(triggers))
	for _, trigger := range triggers {
		ids = append(ids, trigger.ID)
	}
	return ids
}

func mapKeys[T comparable](values map[T]struct{}) []T {
	keys := make([]T, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
