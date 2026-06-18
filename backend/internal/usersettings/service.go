package usersettings

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
)

const endpoint = "user-settings"

type Settings struct {
	DisplayName string `json:"displayName"`
}

type Store struct {
	db *database.Database
}

type Identity interface {
	StableIDForAuthToken(context.Context, *string) (string, error)
}

type Service struct {
	identity   Identity
	store      *Store
	unregister func()
}

type UpdateSettingsRequest struct {
	Settings Settings `json:"settings"`
}

func NewStore(ctx context.Context, db *database.Database) (*Store, error) {
	store := &Store{
		db: db,
	}

	if err := store.migrate(ctx); err != nil {
		return nil, err
	}

	return store, nil
}

func NewService(bus *eventbus.Bus, identity *identityservice.Service, store *Store) *Service {
	service := &Service{
		identity: identity,
		store:    store,
	}

	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"updateSettings": service.updateSettings,
	})

	return service
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (store *Store) GetOrDefault(ctx context.Context, userID string, defaults Settings) (Settings, error) {
	var settings Settings
	err := store.db.QueryRowContext(
		ctx,
		"SELECT display_name FROM user_settings WHERE user_id = ?",
		userID,
	).Scan(&settings.DisplayName)
	if errors.Is(err, sql.ErrNoRows) {
		if strings.TrimSpace(defaults.DisplayName) != "" {
			return Settings{
				DisplayName: strings.TrimSpace(defaults.DisplayName),
			}, nil
		}

		return Settings{DisplayName: userID}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("lookup user settings: %w", err)
	}

	return settings, nil
}

func (store *Store) Update(ctx context.Context, userID string, settings Settings) (Settings, error) {
	normalizedSettings, err := Normalize(settings)
	if err != nil {
		return Settings{}, err
	}

	_, err = store.db.ExecContext(
		ctx,
		`
			INSERT INTO user_settings (user_id, display_name, updated_at_ms)
			VALUES (?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
				display_name = excluded.display_name,
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		normalizedSettings.DisplayName,
		time.Now().UnixMilli(),
	)
	if err != nil {
		return Settings{}, fmt.Errorf("update user settings: %w", err)
	}

	return normalizedSettings, nil
}

func Normalize(settings Settings) (Settings, error) {
	displayName := strings.TrimSpace(settings.DisplayName)
	if len([]rune(displayName)) < 2 {
		return Settings{}, errors.New("displayName must be at least 2 characters")
	}

	return Settings{
		DisplayName: displayName,
	}, nil
}

func (store *Store) migrate(ctx context.Context) error {
	if _, err := store.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS user_settings (
			user_id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			updated_at_ms INTEGER NOT NULL,
			FOREIGN KEY (user_id) REFERENCES auth_users(id)
		)
	`); err != nil {
		return fmt.Errorf("migrate user settings: %w", err)
	}

	return nil
}

func (service *Service) updateSettings(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.identity.StableIDForAuthToken(ctx, &metadata.AuthToken)
	if err != nil {
		return nil, err
	}

	var request UpdateSettingsRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode update settings request: %w", err)
	}

	return service.store.Update(ctx, userID, request.Settings)
}
