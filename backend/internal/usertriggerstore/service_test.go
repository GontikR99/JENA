package usertriggerstore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/identityservice"
	"jena/backend/internal/triggerstore"
	"jena/backend/model"
)

func TestServiceUpsertsAndFetchesTriggersForUser(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	trigger := createCanonicalTestTrigger(t, "Test Trigger", []string{"Raid"})
	character := model.CharacterServer{
		CharacterName: "Mesozoic",
		ServerName:    "Bristlebane",
	}

	update := callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{
			{
				Trigger:    trigger,
				EnabledFor: []model.CharacterServer{character},
			},
		},
	})
	expectedRecord := model.ExtendedTrigger{
		TriggerID:     trigger.ID,
		EnabledFor:    []model.CharacterServer{character},
		BroadcastMode: model.BroadcastModePrivate,
	}

	if !reflect.DeepEqual(update.UpsertedRecords, []model.ExtendedTrigger{expectedRecord}) {
		t.Fatalf("upserted records %#v, want %#v", update.UpsertedRecords, []model.ExtendedTrigger{expectedRecord})
	}
	if !reflect.DeepEqual(update.UpsertedTriggers, []model.Trigger{trigger}) {
		t.Fatalf("upserted triggers %#v, want %#v", update.UpsertedTriggers, []model.Trigger{trigger})
	}
	if update.Revision == "" {
		t.Fatal("revision is empty")
	}

	fetchResponse := callRPC[FetchTriggersResponse](t, bus, "fetchTriggers", "token", map[string]any{})
	if !reflect.DeepEqual(fetchResponse.Records, []model.ExtendedTrigger{expectedRecord}) {
		t.Fatalf("records %#v, want %#v", fetchResponse.Records, []model.ExtendedTrigger{expectedRecord})
	}
	if fetchResponse.Revision != update.Revision {
		t.Fatalf("revision %q, want %q", fetchResponse.Revision, update.Revision)
	}
}

func TestServiceRejectsMissingAuthToken(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	response := callRawRPC(t, bus, "fetchTriggers", "", "test", map[string]any{})
	if response.OK {
		t.Fatal("fetchTriggers unexpectedly succeeded")
	}
	if response.Error == nil || !strings.Contains(response.Error.Message, "auth token is required") {
		t.Fatalf("error %#v, want auth token required error", response.Error)
	}
}

func TestServiceMergesEnabledForAcrossUpserts(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	trigger := createCanonicalTestTrigger(t, "Merge Trigger", []string{"Raid"})

	callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{
			{
				Trigger: trigger,
				EnabledFor: []model.CharacterServer{
					{
						CharacterName: "Suuloti",
						ServerName:    "Bristlebane",
					},
				},
			},
		},
	})
	callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{
			{
				Trigger: trigger,
				EnabledFor: []model.CharacterServer{
					{
						CharacterName: "Mesozoic",
						ServerName:    "Bristlebane",
					},
				},
			},
		},
	})

	fetchResponse := callRPC[FetchTriggersResponse](t, bus, "fetchTriggers", "token", map[string]any{})
	if len(fetchResponse.Records) != 1 {
		t.Fatalf("fetched %d records, want 1", len(fetchResponse.Records))
	}
	if !reflect.DeepEqual(fetchResponse.Records[0].EnabledFor, []model.CharacterServer{
		{
			CharacterName: "Mesozoic",
			ServerName:    "Bristlebane",
		},
		{
			CharacterName: "Suuloti",
			ServerName:    "Bristlebane",
		},
	}) {
		t.Fatalf("enabledFor %#v, want merged character list", fetchResponse.Records[0].EnabledFor)
	}
}

func TestServiceTogglesEnablement(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	trigger := createCanonicalTestTrigger(t, "Toggle Trigger", []string{"Raid"})
	character := model.CharacterServer{
		CharacterName: "Suuloti",
		ServerName:    "Bristlebane",
	}

	callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{
			{
				Trigger:    trigger,
				EnabledFor: []model.CharacterServer{character},
			},
		},
	})
	update := callRPC[model.UserTriggerUpdate](t, bus, "toggleTriggers", "token", ToggleTriggersRequest{
		Changes: []model.TriggerEnablementChange{
			{
				TriggerID: trigger.ID,
				Character: character,
				Enabled:   false,
			},
		},
	})

	if len(update.UpsertedRecords) != 1 {
		t.Fatalf("updated %d records, want 1", len(update.UpsertedRecords))
	}
	if len(update.UpsertedRecords[0].EnabledFor) != 0 {
		t.Fatalf("enabledFor %#v, want empty", update.UpsertedRecords[0].EnabledFor)
	}
}

func TestServiceSetsTriggerFlags(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	trigger := createCanonicalTestTrigger(t, "Flag Trigger", []string{"Raid"})
	callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{{Trigger: trigger}},
	})

	update := callRPC[model.UserTriggerUpdate](t, bus, "setTriggerFlags", "token", SetTriggerFlagsRequest{
		Changes: []model.TriggerFlagChange{
			{
				TriggerID:     trigger.ID,
				Publish:       boolPtr(true),
				BroadcastMode: broadcastModePtr(model.BroadcastModeSubscribers),
			},
		},
	})

	if len(update.UpsertedRecords) != 1 {
		t.Fatalf("updated %d records, want 1", len(update.UpsertedRecords))
	}
	if !update.UpsertedRecords[0].Publish || update.UpsertedRecords[0].BroadcastMode != model.BroadcastModeSubscribers {
		t.Fatalf("record %#v, want publish and subscriber broadcast mode", update.UpsertedRecords[0])
	}

	update = callRPC[model.UserTriggerUpdate](t, bus, "setTriggerFlags", "token", SetTriggerFlagsRequest{
		Changes: []model.TriggerFlagChange{
			{
				TriggerID:     trigger.ID,
				BroadcastMode: broadcastModePtr(model.BroadcastModePrivate),
			},
		},
	})
	if !update.UpsertedRecords[0].Publish || update.UpsertedRecords[0].BroadcastMode != model.BroadcastModePrivate {
		t.Fatalf("record %#v, want publish preserved and private broadcast mode", update.UpsertedRecords[0])
	}
}

func TestServiceImplicitlyDeletesSamePathAndNameOnUpsert(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	oldTrigger := createCanonicalTestTrigger(t, "Same Name", []string{"Raid", "Boss"})
	newTrigger := createCanonicalTestTriggerWithMatch(t, "Same Name", []string{"Raid", "Boss"}, "^changed$")
	character := model.CharacterServer{
		CharacterName: "Suuloti",
		ServerName:    "Bristlebane",
	}

	callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{
			{
				Trigger:    oldTrigger,
				EnabledFor: []model.CharacterServer{character},
			},
		},
	})
	callRPC[model.UserTriggerUpdate](t, bus, "setTriggerFlags", "token", SetTriggerFlagsRequest{
		Changes: []model.TriggerFlagChange{
			{
				TriggerID:     oldTrigger.ID,
				Publish:       boolPtr(true),
				BroadcastMode: broadcastModePtr(model.BroadcastModeSubscribers),
			},
		},
	})
	update := callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{
			{
				Trigger: newTrigger,
			},
		},
	})

	if !reflect.DeepEqual(update.DeletedTriggerIDs, []model.TriggerID{oldTrigger.ID}) {
		t.Fatalf("deleted ids %#v, want %#v", update.DeletedTriggerIDs, []model.TriggerID{oldTrigger.ID})
	}
	if len(update.UpsertedRecords) != 1 || update.UpsertedRecords[0].TriggerID != newTrigger.ID {
		t.Fatalf("upserted records %#v, want new trigger record", update.UpsertedRecords)
	}
	if !reflect.DeepEqual(update.UpsertedRecords[0].EnabledFor, []model.CharacterServer{character}) {
		t.Fatalf("enabledFor %#v, want copied enabled-for", update.UpsertedRecords[0].EnabledFor)
	}
	if !update.UpsertedRecords[0].Publish || update.UpsertedRecords[0].BroadcastMode != model.BroadcastModeSubscribers {
		t.Fatalf("record %#v, want copied flags", update.UpsertedRecords[0])
	}

	fetchResponse := callRPC[FetchTriggersResponse](t, bus, "fetchTriggers", "token", map[string]any{})
	if !reflect.DeepEqual(fetchResponse.Records, []model.ExtendedTrigger{update.UpsertedRecords[0]}) {
		t.Fatalf("records %#v, want only new record", fetchResponse.Records)
	}
}

func TestServiceDeletesTriggers(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	trigger := createCanonicalTestTrigger(t, "Delete Trigger", []string{"Raid"})
	callRPC[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{{Trigger: trigger}},
	})

	update := callRPC[model.UserTriggerUpdate](t, bus, "deleteTriggers", "token", DeleteTriggersRequest{
		TriggerIDs: []model.TriggerID{trigger.ID},
	})
	if !reflect.DeepEqual(update.DeletedTriggerIDs, []model.TriggerID{trigger.ID}) {
		t.Fatalf("deleted ids %#v, want %#v", update.DeletedTriggerIDs, []model.TriggerID{trigger.ID})
	}

	fetchResponse := callRPC[FetchTriggersResponse](t, bus, "fetchTriggers", "token", map[string]any{})
	if len(fetchResponse.Records) != 0 {
		t.Fatalf("records %#v, want empty", fetchResponse.Records)
	}
}

func TestServicePingReturnsCurrentRevision(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	response := callRPC[PingResponse](t, bus, "ping", "token", PingRequest{})
	if response.Revision == "" {
		t.Fatal("revision is empty")
	}
}

func TestServiceBroadcastsUpdatesToUserSources(t *testing.T) {
	ctx := context.Background()
	bus, _, service := newTestService(t, ctx)
	defer service.Dispose()

	source := "ws.127_0_0_1_1.client"
	var event model.UserTriggerUpdate
	received := false
	unlisten := bus.Listen(source+".user-trigger-store.updated", func(_ context.Context, envelope eventbus.Envelope) {
		if err := json.Unmarshal(envelope.Payload, &event); err != nil {
			t.Fatalf("Unmarshal update returned error: %v", err)
		}
		received = true
	})
	defer unlisten()

	trigger := createCanonicalTestTrigger(t, "Broadcast Trigger", []string{"Raid"})
	callRPCWithSource[model.UserTriggerUpdate](t, bus, "upsertTriggers", "token", source, UpsertTriggersRequest{
		Triggers: []model.TriggerUpsert{{Trigger: trigger}},
	})

	if !received {
		t.Fatal("update event was not received")
	}
	if len(event.UpsertedRecords) != 1 || event.UpsertedRecords[0].TriggerID != trigger.ID {
		t.Fatalf("event %#v, want upserted trigger", event)
	}
}

func newTestService(t *testing.T, ctx context.Context) (*eventbus.Bus, *database.Database, *Service) {
	t.Helper()

	bus := eventbus.New()
	db := newTestDatabase(t)
	identity := identityservice.New(fakeSessionResolver{})
	triggerStore, err := triggerstore.New(ctx, bus, db)
	if err != nil {
		t.Fatalf("triggerstore.New returned error: %v", err)
	}
	t.Cleanup(triggerStore.Dispose)

	service, err := New(ctx, bus, db, identity, triggerStore)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}

	return bus, db, service
}

type fakeSessionResolver struct{}

func (resolver fakeSessionResolver) StableIDForSessionToken(_ context.Context, token string) (string, error) {
	if strings.TrimSpace(token) == "" {
		return "", errors.New("auth token is required")
	}

	return "test-user", nil
}

func newTestDatabase(t *testing.T) *database.Database {
	t.Helper()

	db, err := database.New(config.Config{
		DatabaseMaxIdleConns: 1,
		DatabaseMaxOpenConns: 1,
		DatabasePath:         t.TempDir() + "/jena.db",
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

	return db
}

func callRPC[TResponse any](
	t *testing.T,
	bus *eventbus.Bus,
	method string,
	authToken string,
	params any,
) TResponse {
	t.Helper()
	return callRPCWithSource[TResponse](t, bus, method, authToken, "test", params)
}

func callRPCWithSource[TResponse any](
	t *testing.T,
	bus *eventbus.Bus,
	method string,
	authToken string,
	source string,
	params any,
) TResponse {
	t.Helper()

	response := callRawRPC(t, bus, method, authToken, source, params)
	if !response.OK {
		if response.Error == nil {
			t.Fatalf("%s returned unknown RPC error", method)
		}

		t.Fatalf("%s returned RPC error: %s", method, response.Error.Message)
	}

	encodedResult, err := json.Marshal(response.Result)
	if err != nil {
		t.Fatalf("Marshal result returned error: %v", err)
	}

	var result TResponse
	if err := json.Unmarshal(encodedResult, &result); err != nil {
		t.Fatalf("Unmarshal result returned error: %v", err)
	}

	return result
}

func callRawRPC(
	t *testing.T,
	bus *eventbus.Bus,
	method string,
	authToken string,
	source string,
	params any,
) eventbus.RPCResponsePayload {
	t.Helper()

	encodedParams, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("Marshal params returned error: %v", err)
	}

	encodedPayload, err := json.Marshal(eventbus.RPCRequestPayload{
		Method: method,
		Params: encodedParams,
	})
	if err != nil {
		t.Fatalf("Marshal RPC payload returned error: %v", err)
	}

	var response eventbus.RPCResponsePayload
	received := false
	unlisten := bus.Listen(source, func(_ context.Context, envelope eventbus.Envelope) {
		if err := json.Unmarshal(envelope.Payload, &response); err != nil {
			t.Fatalf("Unmarshal RPC response returned error: %v", err)
		}

		received = true
	})
	defer unlisten()

	if err := bus.Send(context.Background(), eventbus.Envelope{
		AuthToken:     authToken,
		CorrelationID: "rpc-1",
		Destination:   endpoint,
		Payload:       encodedPayload,
		Source:        &source,
	}); err != nil {
		t.Fatalf("Send returned error: %v", err)
	}

	if !received {
		t.Fatal("RPC response was not received")
	}

	return response
}

func createCanonicalTestTrigger(t *testing.T, name string, groupPath []string) model.Trigger {
	t.Helper()
	return createCanonicalTestTriggerWithMatch(t, name, groupPath, "^test$")
}

func createCanonicalTestTriggerWithMatch(t *testing.T, name string, groupPath []string, match string) model.Trigger {
	t.Helper()

	trigger := model.Trigger{
		ID:        "draft-trigger",
		Name:      name,
		Comments:  "Test comments",
		Category:  "Default",
		GroupPath: append([]string{}, groupPath...),
		Match: model.TriggerMatcher{
			Text:    match,
			IsRegex: true,
		},
		Actions: model.TriggerActions{
			Display: model.TextAction{
				Enabled: true,
				Text:    "Display",
			},
			Speech: model.SpeechAction{
				Enabled:   true,
				Text:      "Speak",
				Interrupt: true,
			},
			Clipboard: model.ClipboardAction{
				Enabled: true,
				Text:    "Copy",
			},
		},
		Timer: nil,
	}

	canonicalTrigger, err := model.WithCanonicalTriggerID(trigger)
	if err != nil {
		t.Fatalf("WithCanonicalTriggerID returned error: %v", err)
	}

	return canonicalTrigger
}

func boolPtr(value bool) *bool {
	return &value
}

func broadcastModePtr(value model.BroadcastMode) *model.BroadcastMode {
	return &value
}
