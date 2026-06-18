package usersettings

import (
	"context"
	"encoding/json"
	"strings"
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

func TestStoreDefaultsDisplayNameToStableUserID(t *testing.T) {
	store := newTestStore(t)

	settings, err := store.GetOrDefault(context.Background(), "discord:123", Settings{})
	if err != nil {
		t.Fatalf("GetOrDefault returned error: %v", err)
	}
	if settings.DisplayName != "discord:123" {
		t.Fatalf("DisplayName %q, want stable user id", settings.DisplayName)
	}
}

func TestStoreUsesProvidedDefaultDisplayName(t *testing.T) {
	store := newTestStore(t)

	settings, err := store.GetOrDefault(context.Background(), "discord:123", Settings{
		DisplayName: "Mesozoic",
	})
	if err != nil {
		t.Fatalf("GetOrDefault returned error: %v", err)
	}
	if settings.DisplayName != "Mesozoic" {
		t.Fatalf("DisplayName %q, want provided default", settings.DisplayName)
	}
}

func TestStoreUpdatesDisplayName(t *testing.T) {
	store := newTestStore(t)

	updated, err := store.Update(context.Background(), "discord:123", Settings{
		DisplayName: "  Mesozoic  ",
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if updated.DisplayName != "Mesozoic" {
		t.Fatalf("DisplayName %q, want trimmed display name", updated.DisplayName)
	}

	settings, err := store.GetOrDefault(context.Background(), "discord:123", Settings{})
	if err != nil {
		t.Fatalf("GetOrDefault returned error: %v", err)
	}
	if settings.DisplayName != "Mesozoic" {
		t.Fatalf("persisted DisplayName %q, want Mesozoic", settings.DisplayName)
	}
}

func TestNormalizeRejectsShortDisplayName(t *testing.T) {
	_, err := Normalize(Settings{DisplayName: "x"})
	if err == nil || !strings.Contains(err.Error(), "at least 2 characters") {
		t.Fatalf("error %v, want validation error", err)
	}
}

func TestServiceUpdateSettingsAuthenticatesAndPersists(t *testing.T) {
	store := newTestStore(t)
	bus := eventbus.New()
	service := &Service{
		identity: testIdentity{userID: "discord:123"},
		store:    store,
	}
	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"updateSettings": service.updateSettings,
	})
	defer service.Dispose()

	params, err := json.Marshal(UpdateSettingsRequest{
		Settings: Settings{DisplayName: "Mesozoic"},
	})
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	response, err := service.updateSettings(context.Background(), eventbus.RPCMetadata{
		AuthToken: "token",
	}, params)
	if err != nil {
		t.Fatalf("updateSettings returned error: %v", err)
	}

	settings := response.(Settings)
	if settings.DisplayName != "Mesozoic" {
		t.Fatalf("DisplayName %q, want Mesozoic", settings.DisplayName)
	}
}

func newTestStore(t *testing.T) *Store {
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
		CREATE TABLE auth_users (
			id TEXT PRIMARY KEY
		)
	`); err != nil {
		t.Fatalf("create auth_users returned error: %v", err)
	}
	if _, err := db.ExecContext(context.Background(), "INSERT INTO auth_users (id) VALUES (?)", "discord:123"); err != nil {
		t.Fatalf("insert auth user returned error: %v", err)
	}

	store, err := NewStore(context.Background(), db)
	if err != nil {
		t.Fatalf("NewStore returned error: %v", err)
	}

	return store
}
