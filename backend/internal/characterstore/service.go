package characterstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
)

const endpoint = "character-store"
const characterRosterMaxAge = 90 * 24 * time.Hour

type Identity interface {
	StableIDForAuthToken(context.Context, *string) (string, error)
}

type Character struct {
	CharacterName string `json:"characterName"`
	ServerName    string `json:"serverName"`
}

type CharacterSyncRecord struct {
	CharacterName  string `json:"characterName"`
	LastLogWriteMs int64  `json:"lastLogWriteMs"`
	ServerName     string `json:"serverName"`
}

type SyncCharactersRequest struct {
	Characters []CharacterSyncRecord `json:"characters"`
}

type SyncCharactersResponse struct {
	Characters []Character `json:"characters"`
}

type Service struct {
	db         *database.Database
	identity   Identity
	now        func() time.Time
	unregister func()
}

func New(ctx context.Context, bus *eventbus.Bus, db *database.Database, identity Identity) (*Service, error) {
	return NewWithOptions(ctx, bus, db, identity, Options{})
}

type Options struct {
	Now func() time.Time
}

func NewWithOptions(ctx context.Context, bus *eventbus.Bus, db *database.Database, identity Identity, options Options) (*Service, error) {
	now := options.Now
	if now == nil {
		now = time.Now
	}

	service := &Service{
		db:       db,
		identity: identity,
		now:      now,
	}

	if err := service.migrate(ctx); err != nil {
		return nil, err
	}

	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"syncCharacters": service.syncCharacters,
	})

	return service, nil
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (service *Service) syncCharacters(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request SyncCharactersRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode sync characters request: %w", err)
	}

	cutoffMs := service.now().Add(-characterRosterMaxAge).UnixMilli()
	if err := service.upsertCharacters(ctx, userID, normalizeCharacters(request.Characters, cutoffMs)); err != nil {
		return nil, err
	}

	if err := service.deleteStaleCharacters(ctx, userID, cutoffMs); err != nil {
		return nil, err
	}

	characters, err := service.fetchCharacters(ctx, userID)
	if err != nil {
		return nil, err
	}

	return SyncCharactersResponse{Characters: characters}, nil
}

func (service *Service) upsertCharacters(ctx context.Context, userID string, characters []CharacterSyncRecord) error {
	for _, character := range characters {
		if _, err := service.db.ExecContext(
			ctx,
			`
				INSERT INTO user_characters (
					user_id,
					character_name,
					server_name,
					character_name_normalized,
					server_name_normalized,
					last_log_write_ms
				)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(user_id, character_name_normalized, server_name_normalized) DO UPDATE SET
					character_name = excluded.character_name,
					server_name = excluded.server_name,
					last_log_write_ms = excluded.last_log_write_ms
			`,
			userID,
			character.CharacterName,
			character.ServerName,
			normalizeKey(character.CharacterName),
			normalizeKey(character.ServerName),
			character.LastLogWriteMs,
		); err != nil {
			return fmt.Errorf("upsert user character: %w", err)
		}
	}

	return nil
}

func (service *Service) deleteStaleCharacters(ctx context.Context, userID string, cutoffMs int64) error {
	if _, err := service.db.ExecContext(
		ctx,
		`
			DELETE FROM user_characters
			WHERE user_id = ?
				AND last_log_write_ms < ?
		`,
		userID,
		cutoffMs,
	); err != nil {
		return fmt.Errorf("delete stale user characters: %w", err)
	}

	return nil
}

func (service *Service) fetchCharacters(ctx context.Context, userID string) ([]Character, error) {
	rows, err := service.db.QueryContext(
		ctx,
		`
			SELECT character_name, server_name
			FROM user_characters
			WHERE user_id = ?
			ORDER BY character_name COLLATE NOCASE, server_name COLLATE NOCASE
		`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch user characters: %w", err)
	}
	defer rows.Close()

	var characters []Character
	for rows.Next() {
		var character Character
		if err := rows.Scan(&character.CharacterName, &character.ServerName); err != nil {
			return nil, fmt.Errorf("scan user character: %w", err)
		}

		characters = append(characters, character)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user characters: %w", err)
	}

	return characters, nil
}

func (service *Service) migrate(ctx context.Context) error {
	if _, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS user_characters (
			user_id TEXT NOT NULL,
			character_name TEXT NOT NULL,
			server_name TEXT NOT NULL,
			character_name_normalized TEXT NOT NULL,
			server_name_normalized TEXT NOT NULL,
			last_log_write_ms INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (user_id, character_name_normalized, server_name_normalized),
			FOREIGN KEY (user_id) REFERENCES auth_users(id)
		)
	`); err != nil {
		return fmt.Errorf("migrate user characters: %w", err)
	}

	if err := service.ensureColumn(ctx, "last_log_write_ms", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	return nil
}

func (service *Service) ensureColumn(ctx context.Context, columnName string, definition string) error {
	rows, err := service.db.QueryContext(ctx, `PRAGMA table_info(user_characters)`)
	if err != nil {
		return fmt.Errorf("inspect user characters columns: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return fmt.Errorf("scan user characters column: %w", err)
		}
		if name == columnName {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate user characters columns: %w", err)
	}

	if _, err := service.db.ExecContext(
		ctx,
		fmt.Sprintf(`ALTER TABLE user_characters ADD COLUMN %s %s`, columnName, definition),
	); err != nil {
		return fmt.Errorf("add user characters column %s: %w", columnName, err)
	}

	return nil
}

func (service *Service) authenticate(ctx context.Context, metadata eventbus.RPCMetadata) (string, error) {
	if service.identity == nil {
		return "", errors.New("auth identity resolver is not configured")
	}

	return service.identity.StableIDForAuthToken(ctx, &metadata.AuthToken)
}

func normalizeCharacters(characters []CharacterSyncRecord, cutoffMs int64) []CharacterSyncRecord {
	normalizedByKey := make(map[string]CharacterSyncRecord)

	for _, character := range characters {
		normalizedCharacter := CharacterSyncRecord{
			CharacterName:  strings.TrimSpace(character.CharacterName),
			LastLogWriteMs: character.LastLogWriteMs,
			ServerName:     strings.TrimSpace(character.ServerName),
		}
		if normalizedCharacter.CharacterName == "" || normalizedCharacter.ServerName == "" {
			continue
		}
		if normalizedCharacter.LastLogWriteMs < cutoffMs {
			continue
		}

		key := normalizeKey(normalizedCharacter.ServerName) + "\x00" + normalizeKey(normalizedCharacter.CharacterName)
		normalizedByKey[key] = normalizedCharacter
	}

	normalized := make([]CharacterSyncRecord, 0, len(normalizedByKey))
	for _, character := range normalizedByKey {
		normalized = append(normalized, character)
	}

	return normalized
}

func normalizeKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
