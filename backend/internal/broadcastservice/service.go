package broadcastservice

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
	"jena/backend/model"
)

const endpoint = "broadcast"

type Identity interface {
	StableIDForAuthToken(context.Context, *string) (string, error)
}

type Service struct {
	bus        *eventbus.Bus
	db         *database.Database
	identity   Identity
	logger     logging.Logger
	unregister func()
}

type ReflectAlertRequest struct {
	Alert             json.RawMessage      `json:"alert"`
	EventID           string               `json:"eventId"`
	Kind              string               `json:"kind"`
	SubscriptionIDs   []string             `json:"subscriptionIds"`
	UserBroadcastMode *model.BroadcastMode `json:"userBroadcastMode,omitempty"`
}

type alertWithTrigger struct {
	Trigger model.Trigger `json:"trigger"`
}

type reflectedAlert struct {
	Alert          json.RawMessage `json:"alert"`
	EventID        string          `json:"eventId"`
	Kind           string          `json:"kind"`
	SubscriptionID string          `json:"subscriptionId,omitempty"`
}

type broadcastDelivery struct {
	destination    string
	subscriptionID string
}

func New(
	bus *eventbus.Bus,
	db *database.Database,
	identity Identity,
	logger logging.Logger,
) *Service {
	if logger == nil {
		logger = logging.NewNop()
	}

	service := &Service{
		bus:      bus,
		db:       db,
		identity: identity,
		logger:   logger,
	}

	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"reflectAlert": service.reflectAlert,
	})

	return service
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (service *Service) reflectAlert(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	var request ReflectAlertRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode reflect alert request: %w", err)
	}
	if strings.TrimSpace(request.EventID) == "" {
		return nil, errors.New("eventId is required")
	}
	if request.Kind != "triggerMatched" && request.Kind != "timerEarlyEnded" {
		return nil, errors.New("kind must be triggerMatched or timerEarlyEnded")
	}

	var alert alertWithTrigger
	if err := json.Unmarshal(request.Alert, &alert); err != nil {
		return nil, fmt.Errorf("decode reflected alert trigger: %w", err)
	}
	if strings.TrimSpace(string(alert.Trigger.ID)) == "" {
		return nil, errors.New("alert trigger id is required")
	}

	deliveries := make(map[string]broadcastDelivery)
	if request.UserBroadcastMode != nil {
		service.addUserBroadcastDeliveries(ctx, metadata, alert.Trigger.ID, deliveries)
	}
	if len(request.SubscriptionIDs) > 0 {
		if err := service.addSubscriptionBroadcastDeliveries(ctx, request.SubscriptionIDs, alert.Trigger.ID, deliveries); err != nil {
			return nil, err
		}
	}

	if len(deliveries) == 0 {
		return struct{}{}, nil
	}

	source := endpoint
	for _, delivery := range deliveries {
		payload, err := json.Marshal(reflectedAlert{
			Alert:          request.Alert,
			EventID:        request.EventID,
			Kind:           request.Kind,
			SubscriptionID: delivery.subscriptionID,
		})
		if err != nil {
			return nil, fmt.Errorf("encode reflected alert: %w", err)
		}

		_ = service.bus.Send(ctx, eventbus.Envelope{
			Destination: delivery.destination,
			Payload:     payload,
			Source:      &source,
		})
	}

	service.logger.Debug(
		ctx,
		"broadcast alert reflected",
		logging.String("eventId", request.EventID),
		logging.String("kind", request.Kind),
		logging.String("triggerId", string(alert.Trigger.ID)),
		logging.Int("destinationCount", len(deliveries)),
	)

	return struct{}{}, nil
}

func (service *Service) addUserBroadcastDeliveries(
	ctx context.Context,
	metadata eventbus.RPCMetadata,
	triggerID model.TriggerID,
	deliveries map[string]broadcastDelivery,
) {
	userID, err := service.authenticatedUserID(ctx, metadata)
	if err != nil || userID == "" {
		return
	}

	broadcastMode, publish, err := service.userTriggerBroadcastMode(ctx, userID, triggerID)
	if err != nil {
		service.logger.Debug(
			ctx,
			"user broadcast validation failed",
			logging.String("userId", userID),
			logging.String("triggerId", string(triggerID)),
			logging.Error(err),
		)
		return
	}

	switch broadcastMode {
	case model.BroadcastModeBoxes:
		addBroadcastDelivery(deliveries, broadcastDelivery{
			destination: "user." + userID + ".alert.broadcast",
		})
	case model.BroadcastModeSubscribers:
		addBroadcastDelivery(deliveries, broadcastDelivery{
			destination: "user." + userID + ".alert.broadcast",
		})
		if publish {
			subscriptionID, found, err := service.subscriptionIDForPublisher(ctx, userID)
			if err != nil {
				service.logger.Debug(
					ctx,
					"user broadcast subscription lookup failed",
					logging.String("userId", userID),
					logging.Error(err),
				)
				return
			}
			if found {
				addBroadcastDelivery(deliveries, broadcastDelivery{
					destination:    "sub." + userID + ".alert.broadcast",
					subscriptionID: subscriptionID,
				})
			}
		}
	}
}

func (service *Service) addSubscriptionBroadcastDeliveries(
	ctx context.Context,
	subscriptionIDs []string,
	triggerID model.TriggerID,
	deliveries map[string]broadcastDelivery,
) error {
	seen := make(map[string]struct{}, len(subscriptionIDs))
	for _, subscriptionID := range subscriptionIDs {
		normalized, ok := normalizeSubscriptionID(subscriptionID)
		if !ok {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}

		publisherUserID, found, err := service.publisherForSubscriberBroadcast(ctx, normalized, triggerID)
		if err != nil {
			return err
		}
		if !found {
			continue
		}

		addBroadcastDelivery(deliveries, broadcastDelivery{
			destination: "user." + publisherUserID + ".alert.broadcast",
		})
		addBroadcastDelivery(deliveries, broadcastDelivery{
			destination:    "sub." + publisherUserID + ".alert.broadcast",
			subscriptionID: normalized,
		})
	}

	return nil
}

func (service *Service) authenticatedUserID(ctx context.Context, metadata eventbus.RPCMetadata) (string, error) {
	if service.identity == nil {
		return "", errors.New("auth identity resolver is not configured")
	}

	return service.identity.StableIDForAuthToken(ctx, &metadata.AuthToken)
}

func (service *Service) userTriggerBroadcastMode(
	ctx context.Context,
	userID string,
	triggerID model.TriggerID,
) (model.BroadcastMode, bool, error) {
	var broadcastMode model.BroadcastMode
	var publish bool
	err := service.db.QueryRowContext(
		ctx,
		`
			SELECT broadcast_mode, publish
			FROM user_triggers
			WHERE user_id = ?
				AND trigger_id = ?
				AND deleted = 0
		`,
		userID,
		triggerID,
	).Scan(&broadcastMode, &publish)
	if errors.Is(err, sql.ErrNoRows) {
		return model.BroadcastModePrivate, false, nil
	}
	if err != nil {
		return model.BroadcastModePrivate, false, fmt.Errorf("lookup user trigger broadcast mode: %w", err)
	}

	return broadcastMode, publish, nil
}

func (service *Service) publisherForSubscriberBroadcast(
	ctx context.Context,
	subscriptionID string,
	triggerID model.TriggerID,
) (string, bool, error) {
	var publisherUserID string
	err := service.db.QueryRowContext(
		ctx,
		`
			SELECT ps.user_id
			FROM publisher_subscriptions ps
			JOIN user_triggers ut ON ut.user_id = ps.user_id
			WHERE ps.subscription_id = ?
				AND ut.trigger_id = ?
				AND ut.deleted = 0
				AND ut.publish = 1
				AND ut.broadcast_mode = 'subscribers'
		`,
		subscriptionID,
		triggerID,
	).Scan(&publisherUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("lookup subscription broadcast publisher: %w", err)
	}

	return publisherUserID, true, nil
}

func (service *Service) subscriptionIDForPublisher(
	ctx context.Context,
	userID string,
) (string, bool, error) {
	var subscriptionID string
	err := service.db.QueryRowContext(
		ctx,
		"SELECT subscription_id FROM publisher_subscriptions WHERE user_id = ?",
		userID,
	).Scan(&subscriptionID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("lookup publisher subscription id: %w", err)
	}

	return subscriptionID, true, nil
}

func addBroadcastDelivery(
	deliveries map[string]broadcastDelivery,
	delivery broadcastDelivery,
) {
	key := delivery.destination + "\x00" + delivery.subscriptionID
	deliveries[key] = delivery
}

func normalizeSubscriptionID(value string) (string, bool) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}

	return parsed.String(), true
}
