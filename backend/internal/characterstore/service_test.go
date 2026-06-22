package characterstore

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
)

type testIdentity struct {
	userID string
	err    error
}

func (identity testIdentity) StableIDForAuthToken(context.Context, *string) (string, error) {
	if identity.err != nil {
		return "", identity.err
	}

	return identity.userID, nil
}

func TestSyncCharactersInsertsAndReturnsUserCharacters(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"})

	response := syncCharacters(t, service, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
		{CharacterName: "Joram", ServerName: "Fangbreaker"},
	})

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
		{CharacterName: "Joram", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersUpdatesDisplayCasingWithoutDuplicating(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"})

	_ = syncCharacters(t, service, []Character{
		{CharacterName: "jephine", ServerName: "fangbreaker"},
	})
	response := syncCharacters(t, service, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersReturnsExistingCharactersWhenRequestIsEmpty(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"})

	_ = syncCharacters(t, service, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})
	response := syncCharacters(t, service, nil)

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersIsIsolatedByUser(t *testing.T) {
	db := newTestDatabase(t)
	bus := eventbus.New()
	service, err := New(context.Background(), bus, db, testIdentity{userID: "discord:123"})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	insertAuthUser(t, db, "discord:123")
	insertAuthUser(t, db, "discord:456")

	_ = syncCharacters(t, service, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})

	service.identity = testIdentity{userID: "discord:456"}
	response := syncCharacters(t, service, []Character{
		{CharacterName: "Mesozoic", ServerName: "Fangbreaker"},
	})

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Mesozoic", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersRequiresAuthentication(t *testing.T) {
	service := newTestService(t, testIdentity{err: errors.New("not authenticated")})

	params := marshalSyncRequest(t, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})

	_, err := service.syncCharacters(context.Background(), eventbus.RPCMetadata{
		AuthToken: "token",
	}, params)
	if err == nil || err.Error() != "not authenticated" {
		t.Fatalf("error %v, want not authenticated", err)
	}
}

func syncCharacters(t *testing.T, service *Service, characters []Character) SyncCharactersResponse {
	t.Helper()

	response, err := service.syncCharacters(context.Background(), eventbus.RPCMetadata{
		AuthToken: "token",
	}, marshalSyncRequest(t, characters))
	if err != nil {
		t.Fatalf("syncCharacters returned error: %v", err)
	}

	return response.(SyncCharactersResponse)
}

func marshalSyncRequest(t *testing.T, characters []Character) json.RawMessage {
	t.Helper()

	data, err := json.Marshal(SyncCharactersRequest{Characters: characters})
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	return data
}

func assertCharacters(t *testing.T, actual []Character, expected []Character) {
	t.Helper()

	if len(actual) != len(expected) {
		t.Fatalf("characters %#v, want %#v", actual, expected)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("characters[%d] %#v, want %#v", index, actual[index], expected[index])
		}
	}
}

func newTestService(t *testing.T, identity testIdentity) *Service {
	t.Helper()

	db := newTestDatabase(t)
	insertAuthUser(t, db, identity.userID)

	service, err := New(context.Background(), eventbus.New(), db, identity)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(service.Dispose)

	return service
}

func newTestDatabase(t *testing.T) *database.Database {
	t.Helper()

	cfg := config.Config{
		DatabaseMaxIdleConns: 1,
		DatabaseMaxOpenConns: 1,
		DatabasePath:         t.TempDir() + "/jena.db",
		DatabaseRetryCount:   0,
		DatabaseRetryDelayMs: 0,
	}
	db, err := database.New(cfg)
	if err != nil {
		t.Fatalf("database.New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("Close returned error: %v", err)
		}
	})

	if _, err := db.ExecContext(context.Background(), `
		CREATE TABLE IF NOT EXISTS auth_users (
			id TEXT PRIMARY KEY,
			discord_id TEXT NOT NULL UNIQUE,
			username TEXT NOT NULL,
			global_name TEXT,
			avatar_url TEXT,
			created_at_ms INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL
		)
	`); err != nil {
		t.Fatalf("create auth_users returned error: %v", err)
	}

	return db
}

func insertAuthUser(t *testing.T, db *database.Database, userID string) {
	t.Helper()

	if userID == "" {
		return
	}

	if _, err := db.ExecContext(
		context.Background(),
		`
			INSERT OR IGNORE INTO auth_users (
				id,
				discord_id,
				username,
				created_at_ms,
				updated_at_ms
			)
			VALUES (?, ?, ?, 0, 0)
		`,
		userID,
		userID,
		userID,
	); err != nil {
		t.Fatalf("insert auth user returned error: %v", err)
	}
}
