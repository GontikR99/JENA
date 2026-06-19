package subscriptionservice

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
	"jena/backend/internal/usersettings"
	"jena/backend/model"
)

type testIdentity struct {
	err    error
	userID string
}

func (identity testIdentity) StableIDForAuthToken(context.Context, *string) (string, error) {
	if identity.err != nil {
		return "", identity.err
	}

	return identity.userID, nil
}

func TestGetPublishedSubscriptionCodeCreatesAndReusesCode(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"}).service
	ctx := context.Background()

	first := getPublishedSubscriptionCode(t, ctx, service)
	second := getPublishedSubscriptionCode(t, ctx, service)

	if first.ID == "" {
		t.Fatal("ID is required")
	}
	if first.ID != second.ID {
		t.Fatalf("second ID %q, want reused ID %q", second.ID, first.ID)
	}
	if first.Code != "{JENA:sub:"+first.ID+"}" {
		t.Fatalf("Code %q, want JENA subscription code", first.Code)
	}
}

func TestRevokePublishedSubscriptionCodeRotatesCode(t *testing.T) {
	service := newTestService(t, testIdentity{userID: "discord:123"}).service
	ctx := context.Background()

	first := getPublishedSubscriptionCode(t, ctx, service)
	if _, err := service.revokePublishedSubscriptionCode(ctx, eventbus.RPCMetadata{
		AuthToken: "token",
	}, json.RawMessage(`{}`)); err != nil {
		t.Fatalf("revokePublishedSubscriptionCode returned error: %v", err)
	}
	second := getPublishedSubscriptionCode(t, ctx, service)

	if second.ID == first.ID {
		t.Fatalf("second ID %q, want new ID after revocation", second.ID)
	}
}

func TestGetPublishedSubscriptionCodeRequiresAuthentication(t *testing.T) {
	service := newTestService(t, testIdentity{err: errors.New("auth token is required")}).service

	_, err := service.getPublishedSubscriptionCode(context.Background(), eventbus.RPCMetadata{
		AuthToken: "",
	}, json.RawMessage(`{}`))
	if err == nil || !strings.Contains(err.Error(), "auth token is required") {
		t.Fatalf("error %v, want auth error", err)
	}
}

func TestSyncSubscriptionsReturnsPublishedSnapshotAndDigest(t *testing.T) {
	fixture := newTestService(t, testIdentity{userID: "discord:456"})
	ctx := context.Background()
	subscriptionID := insertPublisherSubscription(t, fixture.db, "discord:123", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	insertUserTrigger(t, fixture.db, "discord:123", "11111111-1111-1111-1111-111111111111", true, model.BroadcastModeSubscribers)
	insertUserTrigger(t, fixture.db, "discord:123", "22222222-2222-2222-2222-222222222222", true, model.BroadcastModeBoxes)
	insertUserTrigger(t, fixture.db, "discord:123", "33333333-3333-3333-3333-333333333333", false, model.BroadcastModeSubscribers)

	response := syncSubscriptions(t, ctx, fixture.service, SyncSubscriptionsRequest{
		Subscriptions: []SyncSubscriptionsRequestItem{{ID: subscriptionID}},
	})

	if len(response.Subscriptions) != 1 {
		t.Fatalf("got %d subscription results, want 1", len(response.Subscriptions))
	}
	result := response.Subscriptions[0]
	if result.Status != "updated" {
		t.Fatalf("Status %q, want updated", result.Status)
	}
	if result.OwnerDisplayName != "Publisher" {
		t.Fatalf("OwnerDisplayName %q, want Publisher", result.OwnerDisplayName)
	}
	if result.Digest == "" {
		t.Fatal("Digest is required")
	}
	if len(result.Records) != 2 {
		t.Fatalf("got %d records, want 2", len(result.Records))
	}
	if !result.Records[0].BroadcastToSubscribers {
		t.Fatal("first record should broadcast to subscribers")
	}
	if result.Records[1].BroadcastToSubscribers {
		t.Fatal("second record should not broadcast to subscribers")
	}

	current := syncSubscriptions(t, ctx, fixture.service, SyncSubscriptionsRequest{
		Subscriptions: []SyncSubscriptionsRequestItem{{
			Digest: result.Digest,
			ID:     subscriptionID,
		}},
	})
	if current.Subscriptions[0].Status != "current" {
		t.Fatalf("Status %q, want current", current.Subscriptions[0].Status)
	}
	if len(current.Subscriptions[0].Records) != 0 {
		t.Fatalf("current response included %d records, want none", len(current.Subscriptions[0].Records))
	}
}

func TestSyncSubscriptionsRefreshesCachedDisplayName(t *testing.T) {
	fixture := newTestService(t, testIdentity{userID: "discord:456"})
	ctx := context.Background()
	subscriptionID := insertPublisherSubscription(t, fixture.db, "discord:123", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	insertUserTrigger(t, fixture.db, "discord:123", "11111111-1111-1111-1111-111111111111", true, model.BroadcastModeSubscribers)

	first := syncSubscriptions(t, ctx, fixture.service, SyncSubscriptionsRequest{
		Subscriptions: []SyncSubscriptionsRequestItem{{ID: subscriptionID}},
	}).Subscriptions[0]
	if first.OwnerDisplayName != "Publisher" {
		t.Fatalf("OwnerDisplayName %q, want Publisher", first.OwnerDisplayName)
	}

	if _, err := fixture.userSettings.Update(ctx, "discord:123", usersettings.Settings{
		DisplayName: "Updated Publisher",
	}); err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	second := syncSubscriptions(t, ctx, fixture.service, SyncSubscriptionsRequest{
		Subscriptions: []SyncSubscriptionsRequestItem{{
			Digest: first.Digest,
			ID:     subscriptionID,
		}},
	}).Subscriptions[0]
	if second.Status != "current" {
		t.Fatalf("Status %q, want current", second.Status)
	}
	if second.OwnerDisplayName != "Updated Publisher" {
		t.Fatalf("OwnerDisplayName %q, want Updated Publisher", second.OwnerDisplayName)
	}
}

func TestSyncSubscriptionsHidesOwnSubscription(t *testing.T) {
	fixture := newTestService(t, testIdentity{userID: "discord:123"})
	ctx := context.Background()
	subscriptionID := insertPublisherSubscription(t, fixture.db, "discord:123", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	insertUserTrigger(t, fixture.db, "discord:123", "11111111-1111-1111-1111-111111111111", true, model.BroadcastModeSubscribers)

	params, err := json.Marshal(SyncSubscriptionsRequest{
		Subscriptions: []SyncSubscriptionsRequestItem{{ID: subscriptionID}},
	})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	response, err := fixture.service.syncSubscriptions(ctx, eventbus.RPCMetadata{
		AuthToken: "token",
		Sender:    "ws.127_0_0_1_9.subscribed-trigger-manager",
	}, params)
	if err != nil {
		t.Fatalf("syncSubscriptions returned error: %v", err)
	}

	results := response.(SyncSubscriptionsResponse).Subscriptions
	if len(results) != 1 {
		t.Fatalf("got %d subscription results, want 1", len(results))
	}
	if results[0].Status != "notFound" {
		t.Fatalf("Status %q, want notFound", results[0].Status)
	}
	if sources := fixture.service.activeSubscriberSources("discord:123", time.Now()); len(sources) != 0 {
		t.Fatalf("active sources %#v, want no source registered for own subscription", sources)
	}
}

func TestSyncSubscriptionsTreatsAuthFailureAsAnonymous(t *testing.T) {
	fixture := newTestService(t, testIdentity{err: errors.New("auth failed")})
	ctx := context.Background()
	subscriptionID := insertPublisherSubscription(t, fixture.db, "discord:123", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	insertUserTrigger(t, fixture.db, "discord:123", "11111111-1111-1111-1111-111111111111", true, model.BroadcastModeSubscribers)

	response := syncSubscriptions(t, ctx, fixture.service, SyncSubscriptionsRequest{
		Subscriptions: []SyncSubscriptionsRequestItem{{ID: subscriptionID}},
	})

	if len(response.Subscriptions) != 1 {
		t.Fatalf("got %d subscription results, want 1", len(response.Subscriptions))
	}
	if response.Subscriptions[0].Status != "updated" {
		t.Fatalf("Status %q, want updated", response.Subscriptions[0].Status)
	}
}

func TestSubscriberBridgeFansOutToRecentSubscriberSockets(t *testing.T) {
	fixture := newTestService(t, testIdentity{userID: "discord:456"})
	ctx := context.Background()
	subscriptionID := insertPublisherSubscription(t, fixture.db, "discord:123", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

	params, err := json.Marshal(SyncSubscriptionsRequest{
		Subscriptions: []SyncSubscriptionsRequestItem{{ID: subscriptionID}},
	})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if _, err := fixture.service.syncSubscriptions(ctx, eventbus.RPCMetadata{
		Sender: "ws.127_0_0_1_9.subscribed-trigger-manager",
	}, params); err != nil {
		t.Fatalf("syncSubscriptions returned error: %v", err)
	}

	var received eventbus.Envelope
	receivedCount := 0
	unlisten := fixture.bus.Listen("ws.127_0_0_1_9.subscriptions.updated", func(_ context.Context, envelope eventbus.Envelope) {
		received = envelope
		receivedCount++
	})
	defer unlisten()

	source := "user-trigger-store"
	payload := json.RawMessage(`{"publisherUserId":"discord:123"}`)
	if err := fixture.bus.Send(ctx, eventbus.Envelope{
		Destination: "sub.discord:123.subscriptions.updated",
		Payload:     payload,
		Source:      &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if receivedCount != 1 {
		t.Fatalf("received %d bridged messages, want 1", receivedCount)
	}
	if received.Destination != "ws.127_0_0_1_9.subscriptions.updated" {
		t.Fatalf("Destination %q, want websocket subscription update", received.Destination)
	}
	if string(received.Payload) != string(payload) {
		t.Fatalf("Payload %s, want %s", received.Payload, payload)
	}
}

func TestSubscriberBridgeExpiresStaleSubscriberSockets(t *testing.T) {
	fixture := newTestService(t, testIdentity{userID: "discord:456"})
	ctx := context.Background()

	fixture.service.rememberSubscriberSource(
		"discord:123",
		"ws.127_0_0_1_9.subscribed-trigger-manager",
		time.Now().Add(-subscriberSourceTTL-time.Second),
	)
	if sources := fixture.service.activeSubscriberSources("discord:123", time.Now()); len(sources) != 0 {
		t.Fatalf("active sources %#v, want expired source removed", sources)
	}

	receivedCount := 0
	unlisten := fixture.bus.Listen("ws.127_0_0_1_9.subscriptions.updated", func(context.Context, eventbus.Envelope) {
		receivedCount++
	})
	defer unlisten()

	source := "user-trigger-store"
	if err := fixture.bus.Send(ctx, eventbus.Envelope{
		Destination: "sub.discord:123.subscriptions.updated",
		Payload:     json.RawMessage(`{"publisherUserId":"discord:123"}`),
		Source:      &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}
	if receivedCount != 0 {
		t.Fatalf("received %d bridged messages, want none", receivedCount)
	}
}

func TestUserSubscriptionStorageAndEnablement(t *testing.T) {
	fixture := newTestService(t, testIdentity{userID: "discord:456"})
	ctx := context.Background()
	subscriptionID := insertPublisherSubscription(t, fixture.db, "discord:123", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

	callService(t, ctx, fixture.service.addUserSubscription, SubscriptionIDRequest{
		SubscriptionID: subscriptionID,
	})
	callService(t, ctx, fixture.service.setSubscriptionDefaultEnablement, SetSubscriptionDefaultEnablementRequest{
		Character: model.CharacterServer{
			CharacterName: "Cleric",
			ServerName:    "Tunare",
		},
		Mode:           defaultEnablementEnabled,
		SubscriptionID: subscriptionID,
	})
	callService(t, ctx, fixture.service.setSubscribedTriggerEnablement, SetSubscribedTriggerEnablementRequest{
		Character: model.CharacterServer{
			CharacterName: "Cleric",
			ServerName:    "Tunare",
		},
		Mode:           triggerEnablementDisabled,
		SubscriptionID: subscriptionID,
		TriggerID:      "11111111-1111-1111-1111-111111111111",
	})

	response := fetchUserSubscriptions(t, ctx, fixture.service)
	if len(response.Subscriptions) != 1 || response.Subscriptions[0] != subscriptionID {
		t.Fatalf("Subscriptions %#v, want %q", response.Subscriptions, subscriptionID)
	}
	if len(response.DefaultEnablement) != 1 || response.DefaultEnablement[0].Mode != defaultEnablementEnabled {
		t.Fatalf("DefaultEnablement %#v, want one enabled row", response.DefaultEnablement)
	}
	if len(response.TriggerEnablement) != 1 || response.TriggerEnablement[0].Mode != triggerEnablementDisabled {
		t.Fatalf("TriggerEnablement %#v, want one disabled row", response.TriggerEnablement)
	}

	callService(t, ctx, fixture.service.setSubscribedTriggerEnablement, SetSubscribedTriggerEnablementRequest{
		Character: model.CharacterServer{
			CharacterName: "Cleric",
			ServerName:    "Tunare",
		},
		Mode:           triggerEnablementInherit,
		SubscriptionID: subscriptionID,
		TriggerID:      "11111111-1111-1111-1111-111111111111",
	})
	response = fetchUserSubscriptions(t, ctx, fixture.service)
	if len(response.TriggerEnablement) != 0 {
		t.Fatalf("TriggerEnablement %#v, want cleared rows", response.TriggerEnablement)
	}
}

func TestCleanupRemovesExpiredSubscriptionsAndStaleTriggerOverrides(t *testing.T) {
	fixture := newTestService(t, testIdentity{userID: "discord:456"})
	ctx := context.Background()
	subscriptionID := insertPublisherSubscription(t, fixture.db, "discord:123", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	insertUserTrigger(t, fixture.db, "discord:123", "11111111-1111-1111-1111-111111111111", true, model.BroadcastModeSubscribers)

	callService(t, ctx, fixture.service.addUserSubscription, SubscriptionIDRequest{
		SubscriptionID: subscriptionID,
	})
	callService(t, ctx, fixture.service.setSubscribedTriggerEnablement, SetSubscribedTriggerEnablementRequest{
		Character: model.CharacterServer{
			CharacterName: "Cleric",
			ServerName:    "Tunare",
		},
		Mode:           triggerEnablementEnabled,
		SubscriptionID: subscriptionID,
		TriggerID:      "11111111-1111-1111-1111-111111111111",
	})
	callService(t, ctx, fixture.service.setSubscribedTriggerEnablement, SetSubscribedTriggerEnablementRequest{
		Character: model.CharacterServer{
			CharacterName: "Cleric",
			ServerName:    "Tunare",
		},
		Mode:           triggerEnablementDisabled,
		SubscriptionID: subscriptionID,
		TriggerID:      "22222222-2222-2222-2222-222222222222",
	})

	if err := fixture.service.Cleanup(ctx); err != nil {
		t.Fatalf("Cleanup returned error: %v", err)
	}
	response := fetchUserSubscriptions(t, ctx, fixture.service)
	if len(response.TriggerEnablement) != 1 {
		t.Fatalf("TriggerEnablement %#v, want one non-stale row", response.TriggerEnablement)
	}

	if _, err := fixture.db.ExecContext(ctx, "DELETE FROM publisher_subscriptions WHERE subscription_id = ?", subscriptionID); err != nil {
		t.Fatalf("delete publisher subscription returned error: %v", err)
	}
	if err := fixture.service.Cleanup(ctx); err != nil {
		t.Fatalf("Cleanup after revoke returned error: %v", err)
	}
	response = fetchUserSubscriptions(t, ctx, fixture.service)
	if len(response.Subscriptions) != 0 || len(response.TriggerEnablement) != 0 {
		t.Fatalf("response after revoke %#v, want all rows removed", response)
	}
}

type serviceFixture struct {
	bus          *eventbus.Bus
	db           *database.Database
	service      *Service
	userSettings *usersettings.Store
}

func newTestService(t *testing.T, identity Identity) serviceFixture {
	t.Helper()

	db, err := database.New(config.Config{
		DatabaseMaxIdleConns:     1,
		DatabaseMaxOpenConns:     1,
		DatabasePath:             t.TempDir() + "/jena.db",
		DatabaseRetryCount:       0,
		DatabaseRetryDelayMs:     0,
		SubscriptionCleanupHours: 24,
	})
	if err != nil {
		t.Fatalf("database.New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("Close returned error: %v", err)
		}
	})

	createTestTables(t, db)

	userSettingsStore, err := usersettings.NewStore(context.Background(), db)
	if err != nil {
		t.Fatalf("usersettings.NewStore returned error: %v", err)
	}
	bus := eventbus.New()
	service, err := New(context.Background(), bus, db, identity, userSettingsStore, config.Config{
		SubscriptionCleanupHours: 24,
	}, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(service.Dispose)

	return serviceFixture{
		bus:          bus,
		db:           db,
		service:      service,
		userSettings: userSettingsStore,
	}
}

func createTestTables(t *testing.T, db *database.Database) {
	t.Helper()

	statements := []string{
		`
			CREATE TABLE auth_users (
				id TEXT PRIMARY KEY,
				username TEXT NOT NULL
			)
		`,
		`
			CREATE TABLE user_triggers (
				user_id TEXT NOT NULL,
				trigger_id TEXT NOT NULL,
				deleted INTEGER NOT NULL,
				publish INTEGER NOT NULL,
				broadcast_mode TEXT NOT NULL,
				updated_at_ms INTEGER NOT NULL,
				PRIMARY KEY (user_id, trigger_id)
			)
		`,
		"INSERT INTO auth_users (id, username) VALUES ('discord:123', 'Publisher')",
		"INSERT INTO auth_users (id, username) VALUES ('discord:456', 'Follower')",
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(context.Background(), statement); err != nil {
			t.Fatalf("test table setup failed: %v", err)
		}
	}
}

func insertUserTrigger(t *testing.T, db *database.Database, userID string, triggerID model.TriggerID, publish bool, broadcastMode model.BroadcastMode) {
	t.Helper()

	publishValue := 0
	if publish {
		publishValue = 1
	}
	if _, err := db.ExecContext(
		context.Background(),
		`
			INSERT INTO user_triggers (
				user_id,
				trigger_id,
				deleted,
				publish,
				broadcast_mode,
				updated_at_ms
			)
			VALUES (?, ?, 0, ?, ?, 1)
		`,
		userID,
		triggerID,
		publishValue,
		broadcastMode,
	); err != nil {
		t.Fatalf("insert user trigger returned error: %v", err)
	}
}

func insertPublisherSubscription(t *testing.T, db *database.Database, userID string, subscriptionID string) string {
	t.Helper()

	if _, err := db.ExecContext(
		context.Background(),
		`
			INSERT INTO publisher_subscriptions (
				user_id,
				subscription_id,
				created_at_ms,
				updated_at_ms
			)
			VALUES (?, ?, 1, 1)
		`,
		userID,
		subscriptionID,
	); err != nil {
		t.Fatalf("insert publisher subscription returned error: %v", err)
	}

	return subscriptionID
}

func getPublishedSubscriptionCode(
	t *testing.T,
	ctx context.Context,
	service *Service,
) GetPublishedSubscriptionCodeResponse {
	t.Helper()

	response, err := service.getPublishedSubscriptionCode(ctx, eventbus.RPCMetadata{
		AuthToken: "token",
	}, json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("getPublishedSubscriptionCode returned error: %v", err)
	}

	return response.(GetPublishedSubscriptionCodeResponse)
}

func syncSubscriptions(
	t *testing.T,
	ctx context.Context,
	service *Service,
	request SyncSubscriptionsRequest,
) SyncSubscriptionsResponse {
	t.Helper()

	params, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	response, err := service.syncSubscriptions(ctx, eventbus.RPCMetadata{}, params)
	if err != nil {
		t.Fatalf("syncSubscriptions returned error: %v", err)
	}

	return response.(SyncSubscriptionsResponse)
}

func fetchUserSubscriptions(
	t *testing.T,
	ctx context.Context,
	service *Service,
) FetchUserSubscriptionsResponse {
	t.Helper()

	response, err := service.fetchUserSubscriptions(ctx, eventbus.RPCMetadata{
		AuthToken: "token",
	}, json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("fetchUserSubscriptions returned error: %v", err)
	}

	return response.(FetchUserSubscriptionsResponse)
}

func callService(
	t *testing.T,
	ctx context.Context,
	handler eventbus.RPCHandler,
	request any,
) {
	t.Helper()

	params, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	if _, err := handler(ctx, eventbus.RPCMetadata{
		AuthToken: "token",
	}, params); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
}
