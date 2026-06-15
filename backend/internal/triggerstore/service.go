package triggerstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/model"
)

const endpoint = "trigger-store"

type Service struct {
	db         *database.Database
	unregister func()
}

type StoreTriggersRequest struct {
	Triggers []model.Trigger `json:"triggers"`
}

type StoreTriggersResponse struct {
	Triggers []model.Trigger `json:"triggers"`
}

type FetchTriggersRequest struct {
	IDs []model.TriggerID `json:"ids"`
}

type FetchTriggersResponse struct {
	Triggers []model.Trigger `json:"triggers"`
}

func New(ctx context.Context, bus *eventbus.Bus, db *database.Database) (*Service, error) {
	service := &Service{
		db: db,
	}

	if err := service.migrate(ctx); err != nil {
		return nil, err
	}

	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"fetchTriggers": service.fetchTriggers,
		"storeTriggers": service.storeTriggers,
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
	_, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS triggers (
			id TEXT PRIMARY KEY NOT NULL,
			json TEXT NOT NULL
		)
	`)
	if err != nil {
		return fmt.Errorf("migrate trigger store: %w", err)
	}

	return nil
}

func (service *Service) StoreTrigger(ctx context.Context, trigger model.Trigger) (model.Trigger, error) {
	canonicalTrigger, err := model.WithCanonicalTriggerID(trigger)
	if err != nil {
		return model.Trigger{}, err
	}

	if trigger.ID != canonicalTrigger.ID {
		encodedTrigger, err := json.Marshal(trigger)
		if err != nil {
			return model.Trigger{}, fmt.Errorf("trigger id %q does not match canonical id %q; failed trigger could not be marshaled: %w", trigger.ID, canonicalTrigger.ID, err)
		}

		return model.Trigger{}, fmt.Errorf("trigger id %q does not match canonical id %q; failed trigger json: %s", trigger.ID, canonicalTrigger.ID, string(encodedTrigger))
	}

	encodedTrigger, err := json.Marshal(canonicalTrigger)
	if err != nil {
		return model.Trigger{}, fmt.Errorf("marshal trigger: %w", err)
	}

	if _, err := service.db.ExecContext(
		ctx,
		`
			INSERT INTO triggers (id, json)
			VALUES (?, ?)
			ON CONFLICT(id) DO UPDATE SET json = excluded.json
		`,
		string(canonicalTrigger.ID),
		string(encodedTrigger),
	); err != nil {
		return model.Trigger{}, fmt.Errorf("insert trigger: %w", err)
	}

	return canonicalTrigger, nil
}

func (service *Service) StoreTriggers(ctx context.Context, triggers []model.Trigger) ([]model.Trigger, error) {
	storedTriggers := make([]model.Trigger, 0, len(triggers))

	for _, trigger := range triggers {
		storedTrigger, err := service.StoreTrigger(ctx, trigger)
		if err != nil {
			return nil, err
		}

		storedTriggers = append(storedTriggers, storedTrigger)
	}

	return storedTriggers, nil
}

func (service *Service) GetTrigger(ctx context.Context, id model.TriggerID) (model.Trigger, error) {
	if id == "" {
		return model.Trigger{}, errors.New("trigger id is required")
	}

	var encodedTrigger string
	if err := service.db.QueryRowContext(
		ctx,
		"SELECT json FROM triggers WHERE id = ?",
		string(id),
	).Scan(&encodedTrigger); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.Trigger{}, fmt.Errorf("trigger %q not found", id)
		}

		return model.Trigger{}, fmt.Errorf("lookup trigger: %w", err)
	}

	var trigger model.Trigger
	if err := json.Unmarshal([]byte(encodedTrigger), &trigger); err != nil {
		return model.Trigger{}, fmt.Errorf("decode stored trigger: %w", err)
	}

	return trigger, nil
}

func (service *Service) GetTriggers(ctx context.Context, ids []model.TriggerID) ([]model.Trigger, error) {
	triggers := make([]model.Trigger, 0, len(ids))

	for _, id := range ids {
		trigger, err := service.GetTrigger(ctx, id)
		if err != nil {
			return nil, err
		}

		triggers = append(triggers, trigger)
	}

	return triggers, nil
}

func (service *Service) storeTriggers(ctx context.Context, _ eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	var request StoreTriggersRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode store triggers request: %w", err)
	}

	storedTriggers, err := service.StoreTriggers(ctx, request.Triggers)
	if err != nil {
		return nil, err
	}

	return StoreTriggersResponse{
		Triggers: storedTriggers,
	}, nil
}

func (service *Service) fetchTriggers(ctx context.Context, _ eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	var request FetchTriggersRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode fetch triggers request: %w", err)
	}

	triggers, err := service.GetTriggers(ctx, request.IDs)
	if err != nil {
		return nil, err
	}

	return FetchTriggersResponse{
		Triggers: triggers,
	}, nil
}
