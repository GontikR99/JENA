package broadcastservice

import (
	"context"
	"encoding/json"
	"testing"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
	"jena/backend/model"
)

type testIdentity struct {
	userID string
}

func (identity testIdentity) StableIDForAuthToken(context.Context, *string) (string, error) {
	return identity.userID, nil
}

func TestReflectAlertScopesSubscriptionIDToSubscriberFanout(t *testing.T) {
	ctx := context.Background()
	fixture := newTestService(t, "discord:123")
	triggerID := model.TriggerID("11111111-1111-1111-1111-111111111111")
	subscriptionID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

	insertUserTrigger(
		t,
		fixture.db,
		"discord:123",
		triggerID,
		true,
		model.BroadcastModeSubscribers,
	)
	insertPublisherSubscription(t, fixture.db, "discord:123", subscriptionID)

	deliveries := make(map[string]reflectedAlert)
	fixture.bus.Listen("*.alert.broadcast", func(_ context.Context, envelope eventbus.Envelope) {
		var payload reflectedAlert
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatalf("json.Unmarshal delivery returned error: %v", err)
		}

		deliveries[envelope.Destination] = payload
	})

	request := ReflectAlertRequest{
		Alert: json.RawMessage(
			`{"matchCaptures":{"capturesByKey":{"S":"Viral Decay"},"namedCaptures":{"effect":"Viral Decay"},"positionalCaptures":["Viral Decay"]},"trigger":{"id":"11111111-1111-1111-1111-111111111111"}}`,
		),
		EventID:           "event-1",
		Kind:              "triggerMatched",
		SubscriptionIDs:   []string{subscriptionID},
		UserBroadcastMode: ptr(model.BroadcastModeSubscribers),
	}
	params, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("json.Marshal request returned error: %v", err)
	}

	if _, err := fixture.service.reflectAlert(ctx, eventbus.RPCMetadata{
		AuthToken: "token",
	}, params); err != nil {
		t.Fatalf("reflectAlert returned error: %v", err)
	}

	userDelivery, ok := deliveries["user.discord:123.alert.broadcast"]
	if !ok {
		t.Fatal("missing user fanout delivery")
	}
	if userDelivery.SubscriptionID != "" {
		t.Fatalf("user fanout subscriptionId %q, want empty", userDelivery.SubscriptionID)
	}
	assertDeliveryPreservedMatchCaptures(t, userDelivery)

	subDelivery, ok := deliveries["sub.discord:123.alert.broadcast"]
	if !ok {
		t.Fatal("missing subscriber fanout delivery")
	}
	if subDelivery.SubscriptionID != subscriptionID {
		t.Fatalf(
			"subscriber fanout subscriptionId %q, want %q",
			subDelivery.SubscriptionID,
			subscriptionID,
		)
	}
	assertDeliveryPreservedMatchCaptures(t, subDelivery)
}

type serviceFixture struct {
	bus     *eventbus.Bus
	db      *database.Database
	service *Service
}

func newTestService(t *testing.T, userID string) serviceFixture {
	t.Helper()

	db, err := database.New(config.Config{
		DatabasePath:         t.TempDir() + "/jena.db",
		DatabaseMaxOpenConns: 1,
		DatabaseRetryCount:   0,
		DatabaseRetryDelayMs: 0,
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

	bus := eventbus.New()
	service := New(bus, db, testIdentity{userID: userID}, logging.NewNop())
	t.Cleanup(service.Dispose)

	return serviceFixture{
		bus:     bus,
		db:      db,
		service: service,
	}
}

func createTestTables(t *testing.T, db *database.Database) {
	t.Helper()

	statements := []string{
		`
			CREATE TABLE user_triggers (
				user_id TEXT NOT NULL,
				trigger_id TEXT NOT NULL,
				deleted INTEGER NOT NULL,
				publish INTEGER NOT NULL,
				broadcast_mode TEXT NOT NULL,
				PRIMARY KEY (user_id, trigger_id)
			)
		`,
		`
			CREATE TABLE publisher_subscriptions (
				user_id TEXT PRIMARY KEY,
				subscription_id TEXT NOT NULL UNIQUE
			)
		`,
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(context.Background(), statement); err != nil {
			t.Fatalf("test table setup failed: %v", err)
		}
	}
}

func insertUserTrigger(
	t *testing.T,
	db *database.Database,
	userID string,
	triggerID model.TriggerID,
	publish bool,
	broadcastMode model.BroadcastMode,
) {
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
				broadcast_mode
			)
			VALUES (?, ?, 0, ?, ?)
		`,
		userID,
		triggerID,
		publishValue,
		broadcastMode,
	); err != nil {
		t.Fatalf("insert user trigger returned error: %v", err)
	}
}

func insertPublisherSubscription(
	t *testing.T,
	db *database.Database,
	userID string,
	subscriptionID string,
) {
	t.Helper()

	if _, err := db.ExecContext(
		context.Background(),
		`
			INSERT INTO publisher_subscriptions (
				user_id,
				subscription_id
			)
			VALUES (?, ?)
		`,
		userID,
		subscriptionID,
	); err != nil {
		t.Fatalf("insert publisher subscription returned error: %v", err)
	}
}

func ptr[T any](value T) *T {
	return &value
}

func assertDeliveryPreservedMatchCaptures(t *testing.T, delivery reflectedAlert) {
	t.Helper()

	var alert struct {
		MatchCaptures struct {
			CapturesByKey      map[string]string `json:"capturesByKey"`
			NamedCaptures      map[string]string `json:"namedCaptures"`
			PositionalCaptures []string          `json:"positionalCaptures"`
		} `json:"matchCaptures"`
	}
	if err := json.Unmarshal(delivery.Alert, &alert); err != nil {
		t.Fatalf("json.Unmarshal delivery alert returned error: %v", err)
	}
	if got := alert.MatchCaptures.CapturesByKey["S"]; got != "Viral Decay" {
		t.Fatalf("capturesByKey[S] = %q, want Viral Decay", got)
	}
	if got := alert.MatchCaptures.NamedCaptures["effect"]; got != "Viral Decay" {
		t.Fatalf("namedCaptures[effect] = %q, want Viral Decay", got)
	}
	if len(alert.MatchCaptures.PositionalCaptures) != 1 ||
		alert.MatchCaptures.PositionalCaptures[0] != "Viral Decay" {
		t.Fatalf(
			"positionalCaptures = %#v, want [Viral Decay]",
			alert.MatchCaptures.PositionalCaptures,
		)
	}
}
