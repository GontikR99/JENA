package sharingservice

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/triggerstore"
	"jena/backend/internal/usersettings"
	"jena/backend/model"
)

type testIdentity struct {
	userID string
}

func (identity testIdentity) StableIDForAuthToken(context.Context, *string) (string, error) {
	return identity.userID, nil
}

func TestCreateSharePackageFiltersMissingAndDuplicateTriggers(t *testing.T) {
	service, triggerStore, _ := newTestService(t, testIdentity{})
	ctx := context.Background()
	trigger := storeTestTrigger(t, ctx, triggerStore, "Shared Trigger")

	response := createSharePackage(t, ctx, service, eventbus.RPCMetadata{}, CreateSharePackageRequest{
		TriggerIDs: []model.TriggerID{
			trigger.ID,
			"missing-trigger",
			trigger.ID,
		},
	})

	if !strings.HasPrefix(response.Code, "{JENA:share:") {
		t.Fatalf("Code %q, want JENA share code", response.Code)
	}
	if response.TriggerIDs == nil || len(response.TriggerIDs) != 1 || response.TriggerIDs[0] != trigger.ID {
		t.Fatalf("TriggerIDs %#v, want only stored trigger id", response.TriggerIDs)
	}

	resolved := resolveSharePackage(t, ctx, service, ResolveSharePackageRequest{
		Code: response.Code,
	})
	if resolved.CreatorDisplayName != anonymousDisplayName {
		t.Fatalf("CreatorDisplayName %q, want anonymous", resolved.CreatorDisplayName)
	}
	if len(resolved.TriggerIDs) != 1 || resolved.TriggerIDs[0] != trigger.ID {
		t.Fatalf("resolved TriggerIDs %#v, want stored trigger id", resolved.TriggerIDs)
	}
}

func TestResolveSharePackageLooksUpCurrentDisplayName(t *testing.T) {
	service, triggerStore, userSettings := newTestService(t, testIdentity{
		userID: "discord:123",
	})
	ctx := context.Background()
	trigger := storeTestTrigger(t, ctx, triggerStore, "Shared Trigger")

	response := createSharePackage(t, ctx, service, eventbus.RPCMetadata{
		AuthToken: "token",
	}, CreateSharePackageRequest{
		TriggerIDs: []model.TriggerID{trigger.ID},
	})

	if _, err := userSettings.Update(ctx, "discord:123", usersettings.Settings{
		DisplayName: "Current Name",
	}); err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	resolved := resolveSharePackage(t, ctx, service, ResolveSharePackageRequest{
		Code: response.Code,
	})
	if resolved.CreatorDisplayName != "Current Name" {
		t.Fatalf("CreatorDisplayName %q, want current settings display name", resolved.CreatorDisplayName)
	}
}

func TestResolveSharePackageRejectsExpiredPackage(t *testing.T) {
	service, triggerStore, _ := newTestService(t, testIdentity{})
	ctx := context.Background()
	trigger := storeTestTrigger(t, ctx, triggerStore, "Shared Trigger")

	response := createSharePackage(t, ctx, service, eventbus.RPCMetadata{}, CreateSharePackageRequest{
		TriggerIDs: []model.TriggerID{trigger.ID},
	})
	if _, err := service.db.ExecContext(
		ctx,
		"UPDATE share_packages SET expires_at_ms = ? WHERE id = ?",
		time.Now().Add(-time.Minute).UnixMilli(),
		response.ID,
	); err != nil {
		t.Fatalf("expire package returned error: %v", err)
	}

	_, err := service.resolveSharePackage(ctx, eventbus.RPCMetadata{}, mustMarshal(t, ResolveSharePackageRequest{
		Code: response.Code,
	}))
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("error %v, want expired package error", err)
	}

	if err := service.DeleteExpired(ctx); err != nil {
		t.Fatalf("DeleteExpired returned error: %v", err)
	}

	var count int
	if err := service.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM share_packages WHERE id = ?", response.ID).Scan(&count); err != nil {
		t.Fatalf("count package returned error: %v", err)
	}
	if count != 0 {
		t.Fatalf("package count %d, want deleted", count)
	}
}

func newTestService(t *testing.T, identity Identity) (*Service, *triggerstore.Service, *usersettings.Store) {
	t.Helper()

	cfg := config.Config{
		DatabaseMaxIdleConns:       1,
		DatabaseMaxOpenConns:       1,
		DatabasePath:               t.TempDir() + "/jena.db",
		DatabaseRetryCount:         0,
		DatabaseRetryDelayMs:       0,
		SharePackageCleanupMinutes: 5,
		SharePackageTTLMins:        240,
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
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL
		)
	`); err != nil {
		t.Fatalf("create auth_users returned error: %v", err)
	}
	if _, err := db.ExecContext(context.Background(), "INSERT INTO auth_users (id, username) VALUES (?, ?)", "discord:123", "discord-user"); err != nil {
		t.Fatalf("insert auth user returned error: %v", err)
	}

	bus := eventbus.New()
	userSettings, err := usersettings.NewStore(context.Background(), db)
	if err != nil {
		t.Fatalf("usersettings.NewStore returned error: %v", err)
	}
	triggerStore, err := triggerstore.New(context.Background(), bus, db)
	if err != nil {
		t.Fatalf("triggerstore.New returned error: %v", err)
	}
	t.Cleanup(triggerStore.Dispose)

	service, err := New(context.Background(), bus, db, identity, triggerStore, userSettings, cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(service.Dispose)

	return service, triggerStore, userSettings
}

func storeTestTrigger(t *testing.T, ctx context.Context, triggerStore *triggerstore.Service, name string) model.Trigger {
	t.Helper()

	trigger, err := model.WithCanonicalTriggerID(model.Trigger{
		Actions:   model.TriggerActions{},
		Category:  "Default",
		GroupPath: []string{"Shared"},
		Match: model.TriggerMatcher{
			IsRegex: false,
			Text:    name,
		},
		Name: name,
	})
	if err != nil {
		t.Fatalf("WithCanonicalTriggerID returned error: %v", err)
	}

	storedTrigger, err := triggerStore.StoreTrigger(ctx, trigger)
	if err != nil {
		t.Fatalf("StoreTrigger returned error: %v", err)
	}

	return storedTrigger
}

func createSharePackage(
	t *testing.T,
	ctx context.Context,
	service *Service,
	metadata eventbus.RPCMetadata,
	request CreateSharePackageRequest,
) CreateSharePackageResponse {
	t.Helper()

	response, err := service.createSharePackage(ctx, metadata, mustMarshal(t, request))
	if err != nil {
		t.Fatalf("createSharePackage returned error: %v", err)
	}

	return response.(CreateSharePackageResponse)
}

func resolveSharePackage(
	t *testing.T,
	ctx context.Context,
	service *Service,
	request ResolveSharePackageRequest,
) ResolveSharePackageResponse {
	t.Helper()

	response, err := service.resolveSharePackage(ctx, eventbus.RPCMetadata{}, mustMarshal(t, request))
	if err != nil {
		t.Fatalf("resolveSharePackage returned error: %v", err)
	}

	return response.(ResolveSharePackageResponse)
}

func mustMarshal(t *testing.T, value any) json.RawMessage {
	t.Helper()

	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	return data
}
