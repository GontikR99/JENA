package triggerstore

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
	"jena/backend/model"
)

func TestServiceStoresAndFetchesTriggersByID(t *testing.T) {
	ctx := context.Background()
	bus := eventbus.New()
	db := newTestDatabase(t)
	service, err := New(ctx, bus, db, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	firstTrigger := createCanonicalTestTrigger(t, "First Trigger")
	secondTrigger := createCanonicalTestTrigger(t, "Second Trigger")

	storeResponse := callRPC[StoreTriggersResponse](t, bus, "storeTriggers", StoreTriggersRequest{
		Triggers: []model.Trigger{firstTrigger, secondTrigger},
	})

	if !reflect.DeepEqual(storeResponse.Triggers, []model.Trigger{firstTrigger, secondTrigger}) {
		t.Fatalf("stored triggers %#v, want %#v", storeResponse.Triggers, []model.Trigger{firstTrigger, secondTrigger})
	}

	fetchResponse := callRPC[FetchTriggersResponse](t, bus, "fetchTriggers", FetchTriggersRequest{
		IDs: []model.TriggerID{secondTrigger.ID, firstTrigger.ID},
	})

	if !reflect.DeepEqual(fetchResponse.Triggers, []model.Trigger{secondTrigger, firstTrigger}) {
		t.Fatalf("fetched triggers %#v, want %#v", fetchResponse.Triggers, []model.Trigger{secondTrigger, firstTrigger})
	}
	if fetchResponse.Partial {
		t.Fatal("fetch response was partial, want complete")
	}
}

func TestServiceFetchesTriggersPartiallyByLimit(t *testing.T) {
	ctx := context.Background()
	bus := eventbus.New()
	db := newTestDatabase(t)
	service, err := New(ctx, bus, db, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	firstTrigger := createCanonicalTestTrigger(t, "First Trigger")
	secondTrigger := createCanonicalTestTrigger(t, "Second Trigger")

	callRPC[StoreTriggersResponse](t, bus, "storeTriggers", StoreTriggersRequest{
		Triggers: []model.Trigger{firstTrigger, secondTrigger},
	})

	triggers, partial, err := service.GetTriggersPartial(
		ctx,
		[]model.TriggerID{firstTrigger.ID, secondTrigger.ID},
		1,
	)
	if err != nil {
		t.Fatalf("GetTriggersPartial returned error: %v", err)
	}
	if !partial {
		t.Fatal("partial was false, want true")
	}
	if !reflect.DeepEqual(triggers, []model.Trigger{firstTrigger}) {
		t.Fatalf("triggers %#v, want first trigger only", triggers)
	}
}

func TestServiceFetchTriggersRPCReturnsAtMostOneHundredTriggers(t *testing.T) {
	ctx := context.Background()
	bus := eventbus.New()
	db := newTestDatabase(t)
	service, err := New(ctx, bus, db, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	triggers := make([]model.Trigger, 0, fetchTriggerResponseLimit+1)
	ids := make([]model.TriggerID, 0, fetchTriggerResponseLimit+1)
	for index := range fetchTriggerResponseLimit + 1 {
		trigger := createCanonicalTestTrigger(t, fmt.Sprintf("Trigger %03d", index))
		triggers = append(triggers, trigger)
		ids = append(ids, trigger.ID)
	}

	callRPC[StoreTriggersResponse](t, bus, "storeTriggers", StoreTriggersRequest{
		Triggers: triggers,
	})

	fetchResponse := callRPC[FetchTriggersResponse](t, bus, "fetchTriggers", FetchTriggersRequest{
		IDs: ids,
	})

	if !fetchResponse.Partial {
		t.Fatal("partial was false, want true")
	}
	if len(fetchResponse.Triggers) != fetchTriggerResponseLimit {
		t.Fatalf("fetched %d triggers, want %d", len(fetchResponse.Triggers), fetchTriggerResponseLimit)
	}
	if !reflect.DeepEqual(fetchResponse.Triggers, triggers[:fetchTriggerResponseLimit]) {
		t.Fatal("fetched triggers did not match first requested page")
	}
}

func TestServiceChecksMissingTriggerIDs(t *testing.T) {
	ctx := context.Background()
	bus := eventbus.New()
	db := newTestDatabase(t)
	service, err := New(ctx, bus, db, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	firstTrigger := createCanonicalTestTrigger(t, "First Trigger")
	secondTrigger := createCanonicalTestTrigger(t, "Second Trigger")

	callRPC[StoreTriggersResponse](t, bus, "storeTriggers", StoreTriggersRequest{
		Triggers: []model.Trigger{firstTrigger},
	})

	response := callRPC[CheckTriggersResponse](t, bus, "checkTriggers", CheckTriggersRequest{
		IDs: []model.TriggerID{
			firstTrigger.ID,
			secondTrigger.ID,
			"missing-trigger",
			secondTrigger.ID,
			"",
		},
	})

	expectedMissingIDs := []model.TriggerID{
		secondTrigger.ID,
		"missing-trigger",
		"",
	}
	if !reflect.DeepEqual(response.MissingIDs, expectedMissingIDs) {
		t.Fatalf("missing ids %#v, want %#v", response.MissingIDs, expectedMissingIDs)
	}
}

func TestServiceRejectsTriggerWithMismatchedID(t *testing.T) {
	ctx := context.Background()
	bus := eventbus.New()
	db := newTestDatabase(t)
	service, err := New(ctx, bus, db, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	trigger := createCanonicalTestTrigger(t, "Test Trigger")
	trigger.ID = "client-supplied-bad-id"

	response := callRawRPC(t, bus, "storeTriggers", StoreTriggersRequest{
		Triggers: []model.Trigger{trigger},
	})

	if response.OK {
		t.Fatal("storeTriggers unexpectedly succeeded")
	}
	if response.Error == nil || !strings.Contains(response.Error.Message, "does not match canonical id") {
		t.Fatalf("error %#v, want canonical id mismatch", response.Error)
	}
	if !strings.Contains(response.Error.Message, "failed trigger json:") {
		t.Fatalf("error %q, want failed trigger json", response.Error.Message)
	}
}

func TestServiceStoresImportedTriggerWithAngleBrackets(t *testing.T) {
	ctx := context.Background()
	bus := eventbus.New()
	db := newTestDatabase(t)
	service, err := New(ctx, bus, db, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	const encodedTrigger = `{"actions":{"display":{"enabled":false,"text":"Feigned Death - Stand Up"},"speech":{"enabled":true,"text":"Stand Up","interrupt":false},"clipboard":{"enabled":false,"text":""}},"category":"Debuffs","comments":"","groupPath":["AD Triggers","Raids","House of Thule","Tier 3","Guardian of the House (HoT Upper)"],"match":{"text":"a groundshattering golem begins to cast a spell\\. <Earthshock>","isRegex":true},"name":"A groundshattering golem - Earthshock","timer":{"type":"repeating","name":"FD/DD AE","durationMs":30000,"startBehavior":"restart","warningSeconds":0,"warningAction":null,"endedAction":null,"earlyEnders":[{"text":"end timer","isRegex":true},{"text":"you have been slain","isRegex":true},{"text":"a groundshattering golem has been slain","isRegex":true},{"text":"you have slain a ground","isRegex":true},{"text":"'s corpse falls to the ground","isRegex":true}]},"id":"69afb40d-fdfd-6419-4043-4ff2c1f885fc"}`

	var trigger model.Trigger
	if err := json.Unmarshal([]byte(encodedTrigger), &trigger); err != nil {
		t.Fatalf("Unmarshal failed trigger returned error: %v", err)
	}

	storeResponse := callRPC[StoreTriggersResponse](t, bus, "storeTriggers", StoreTriggersRequest{
		Triggers: []model.Trigger{trigger},
	})

	if !reflect.DeepEqual(storeResponse.Triggers, []model.Trigger{trigger}) {
		t.Fatalf("stored triggers %#v, want %#v", storeResponse.Triggers, []model.Trigger{trigger})
	}

	fetchResponse := callRPC[FetchTriggersResponse](t, bus, "fetchTriggers", FetchTriggersRequest{
		IDs: []model.TriggerID{trigger.ID},
	})

	if !reflect.DeepEqual(fetchResponse.Triggers, []model.Trigger{trigger}) {
		t.Fatalf("fetched triggers %#v, want %#v", fetchResponse.Triggers, []model.Trigger{trigger})
	}
	if fetchResponse.Partial {
		t.Fatal("fetch response was partial, want complete")
	}
}

func TestServiceReturnsErrorForMissingTrigger(t *testing.T) {
	ctx := context.Background()
	bus := eventbus.New()
	db := newTestDatabase(t)
	service, err := New(ctx, bus, db, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Dispose()

	response := callRawRPC(t, bus, "fetchTriggers", FetchTriggersRequest{
		IDs: []model.TriggerID{"missing-trigger"},
	})

	if response.OK {
		t.Fatal("fetchTriggers unexpectedly succeeded")
	}
	if response.Error == nil || !strings.Contains(response.Error.Message, "not found") {
		t.Fatalf("error %#v, want not found", response.Error)
	}
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
	params any,
) TResponse {
	t.Helper()

	response := callRawRPC(t, bus, method, params)
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

	source := "test"
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

func createCanonicalTestTrigger(t *testing.T, name string) model.Trigger {
	t.Helper()

	trigger := model.Trigger{
		ID:       "draft-trigger",
		Name:     name,
		Comments: "Test comments",
		Category: "Default",
		GroupPath: []string{
			"Raid",
			"Boss",
		},
		Match: model.TriggerMatcher{
			Text:    "^test$",
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
		Timer: &model.TriggerTimer{
			Type:           model.TriggerTimerTypeCountdown,
			Name:           "Timer",
			DurationMs:     10_000,
			StartBehavior:  model.TimerStartBehaviorRestart,
			WarningSeconds: 5,
			EarlyEnders: []model.TimerEarlyEnder{
				{
					Text:    "done",
					IsRegex: true,
				},
			},
		},
	}

	canonicalTrigger, err := model.WithCanonicalTriggerID(trigger)
	if err != nil {
		t.Fatalf("WithCanonicalTriggerID returned error: %v", err)
	}

	return canonicalTrigger
}
