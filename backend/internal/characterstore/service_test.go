package characterstore

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
)

var testNow = time.Date(2026, time.June, 22, 12, 0, 0, 0, time.UTC)

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

	response := syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("Jephine", "Fangbreaker"),
		freshCharacter("Joram", "Fangbreaker"),
	})

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
		{CharacterName: "Joram", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersUpdatesDisplayCasingWithoutDuplicating(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"})

	_ = syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("jephine", "fangbreaker"),
	})
	response := syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("Jephine", "Fangbreaker"),
	})

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersReturnsExistingCharactersWhenRequestIsEmpty(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"})

	_ = syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("Jephine", "Fangbreaker"),
	})
	response := syncCharacters(t, service, nil)

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersIgnoresStaleLogFiles(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"})

	response := syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("Jephine", "Fangbreaker"),
		{
			CharacterName:  "Oldtimer",
			LastLogWriteMs: testNow.Add(-characterRosterMaxAge - time.Millisecond).UnixMilli(),
			ServerName:     "Fangbreaker",
		},
	})

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Jephine", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersPrunesExistingStaleRows(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"})

	_ = syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("Jephine", "Fangbreaker"),
	})

	service.now = func() time.Time {
		return testNow.Add(characterRosterMaxAge + time.Millisecond)
	}
	response := syncCharacters(t, service, nil)

	assertCharacters(t, response.Characters, nil)
}

func TestMigrationAddsLastLogWriteMsAndPrunesLegacyRows(t *testing.T) {
	db := newTestDatabase(t)
	insertAuthUser(t, db, "discord:123")
	createLegacyUserCharactersTable(t, db)
	insertLegacyUserCharacter(t, db, "discord:123", "Jephine", "Fangbreaker")

	service, err := NewWithOptions(context.Background(), eventbus.New(), db, testIdentity{userID: "discord:123"}, Options{
		Now: func() time.Time {
			return testNow
		},
	})
	if err != nil {
		t.Fatalf("NewWithOptions returned error: %v", err)
	}
	t.Cleanup(service.Dispose)

	response := syncCharacters(t, service, nil)

	assertCharacters(t, response.Characters, nil)
	assertColumnExists(t, db, "last_log_write_ms")
}

func TestSyncCharactersIsIsolatedByUser(t *testing.T) {
	db := newTestDatabase(t)
	bus := eventbus.New()
	service, err := NewWithOptions(context.Background(), bus, db, testIdentity{userID: "discord:123"}, Options{
		Now: func() time.Time {
			return testNow
		},
	})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	insertAuthUser(t, db, "discord:123")
	insertAuthUser(t, db, "discord:456")

	_ = syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("Jephine", "Fangbreaker"),
	})

	service.identity = testIdentity{userID: "discord:456"}
	response := syncCharacters(t, service, []CharacterSyncRecord{
		freshCharacter("Mesozoic", "Fangbreaker"),
	})

	assertCharacters(t, response.Characters, []Character{
		{CharacterName: "Mesozoic", ServerName: "Fangbreaker"},
	})
}

func TestSyncCharactersRequiresAuthentication(t *testing.T) {
	service := newTestService(t, testIdentity{err: errors.New("not authenticated")})

	params := marshalSyncRequest(t, []CharacterSyncRecord{
		freshCharacter("Jephine", "Fangbreaker"),
	})

	_, err := service.syncCharacters(context.Background(), eventbus.RPCMetadata{
		AuthToken: "token",
	}, params)
	if err == nil || err.Error() != "not authenticated" {
		t.Fatalf("error %v, want not authenticated", err)
	}
}

func syncCharacters(t *testing.T, service *Service, characters []CharacterSyncRecord) SyncCharactersResponse {
	t.Helper()

	response, err := service.syncCharacters(context.Background(), eventbus.RPCMetadata{
		AuthToken: "token",
	}, marshalSyncRequest(t, characters))
	if err != nil {
		t.Fatalf("syncCharacters returned error: %v", err)
	}

	return response.(SyncCharactersResponse)
}

func marshalSyncRequest(t *testing.T, characters []CharacterSyncRecord) json.RawMessage {
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

func freshCharacter(characterName string, serverName string) CharacterSyncRecord {
	return CharacterSyncRecord{
		CharacterName:  characterName,
		LastLogWriteMs: testNow.UnixMilli(),
		ServerName:     serverName,
	}
}

func newTestService(t *testing.T, identity testIdentity) *Service {
	t.Helper()

	db := newTestDatabase(t)
	insertAuthUser(t, db, identity.userID)

	service, err := NewWithOptions(context.Background(), eventbus.New(), db, identity, Options{
		Now: func() time.Time {
			return testNow
		},
	})
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

func createLegacyUserCharactersTable(t *testing.T, db *database.Database) {
	t.Helper()

	if _, err := db.ExecContext(context.Background(), `
		CREATE TABLE IF NOT EXISTS user_characters (
			user_id TEXT NOT NULL,
			character_name TEXT NOT NULL,
			server_name TEXT NOT NULL,
			character_name_normalized TEXT NOT NULL,
			server_name_normalized TEXT NOT NULL,
			PRIMARY KEY (user_id, character_name_normalized, server_name_normalized),
			FOREIGN KEY (user_id) REFERENCES auth_users(id)
		)
	`); err != nil {
		t.Fatalf("create legacy user_characters returned error: %v", err)
	}
}

func insertLegacyUserCharacter(t *testing.T, db *database.Database, userID string, characterName string, serverName string) {
	t.Helper()

	if _, err := db.ExecContext(
		context.Background(),
		`
			INSERT INTO user_characters (
				user_id,
				character_name,
				server_name,
				character_name_normalized,
				server_name_normalized
			)
			VALUES (?, ?, ?, ?, ?)
		`,
		userID,
		characterName,
		serverName,
		normalizeKey(characterName),
		normalizeKey(serverName),
	); err != nil {
		t.Fatalf("insert legacy user character returned error: %v", err)
	}
}

func assertColumnExists(t *testing.T, db *database.Database, columnName string) {
	t.Helper()

	rows, err := db.QueryContext(context.Background(), `PRAGMA table_info(user_characters)`)
	if err != nil {
		t.Fatalf("PRAGMA table_info returned error: %v", err)
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
			t.Fatalf("scan column returned error: %v", err)
		}
		if name == columnName {
			return
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate columns returned error: %v", err)
	}

	t.Fatalf("column %q was not found", columnName)
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
