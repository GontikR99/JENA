package subscriptionservice

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
	"jena/backend/internal/usersettings"
	"jena/backend/model"
)

const (
	endpoint = "subscriptions"

	defaultEnablementEnabled  = "enabled"
	defaultEnablementDisabled = "disabled"

	subscriberSourceTTL = 2 * time.Minute

	triggerEnablementEnabled  = "enabled"
	triggerEnablementDisabled = "disabled"
	triggerEnablementInherit  = "inherit"
)

type Identity interface {
	StableIDForAuthToken(context.Context, *string) (string, error)
}

type Service struct {
	cleanupInterval time.Duration
	db              *database.Database
	identity        Identity
	logger          logging.Logger
	subscriberMu    sync.Mutex
	subscribers     map[string]map[string]time.Time
	snapshotMu      sync.Mutex
	snapshots       map[string]publishedSnapshot
	unregister      func()
	userSettings    *usersettings.Store
}

type GetPublishedSubscriptionCodeResponse struct {
	Code string `json:"code"`
	ID   string `json:"id"`
}

type SubscriptionTriggerRecord struct {
	BroadcastToSubscribers bool            `json:"broadcastToSubscribers"`
	TriggerID              model.TriggerID `json:"triggerId"`
}

type SyncSubscriptionsRequest struct {
	Subscriptions []SyncSubscriptionsRequestItem `json:"subscriptions"`
}

type SyncSubscriptionsRequestItem struct {
	Digest string `json:"digest"`
	ID     string `json:"id"`
}

type SyncSubscriptionsResponse struct {
	Subscriptions []SyncSubscriptionsResult `json:"subscriptions"`
}

type SyncSubscriptionsResult struct {
	Digest           string                      `json:"digest,omitempty"`
	ID               string                      `json:"id"`
	OwnerDisplayName string                      `json:"ownerDisplayName,omitempty"`
	Records          []SubscriptionTriggerRecord `json:"records"`
	Status           string                      `json:"status"`
}

type FetchUserSubscriptionsResponse struct {
	DefaultEnablement []SubscriptionDefaultEnablementRecord `json:"defaultEnablement"`
	Subscriptions     []string                              `json:"subscriptions"`
	TriggerEnablement []SubscriptionTriggerEnablementRecord `json:"triggerEnablement"`
}

type SubscriptionDefaultEnablementRecord struct {
	Character      model.CharacterServer `json:"character"`
	Mode           string                `json:"mode"`
	SubscriptionID string                `json:"subscriptionId"`
}

type SubscriptionTriggerEnablementRecord struct {
	Character      model.CharacterServer `json:"character"`
	Mode           string                `json:"mode"`
	SubscriptionID string                `json:"subscriptionId"`
	TriggerID      model.TriggerID       `json:"triggerId"`
}

type SubscriptionIDRequest struct {
	SubscriptionID string `json:"subscriptionId"`
}

type SetSubscriptionDefaultEnablementRequest struct {
	Character      model.CharacterServer `json:"character"`
	Mode           string                `json:"mode"`
	SubscriptionID string                `json:"subscriptionId"`
}

type SetSubscribedTriggerEnablementRequest struct {
	Character      model.CharacterServer `json:"character"`
	Mode           string                `json:"mode"`
	SubscriptionID string                `json:"subscriptionId"`
	TriggerID      model.TriggerID       `json:"triggerId"`
}

type publishedSnapshot struct {
	digest           string
	ownerDisplayName string
	records          []SubscriptionTriggerRecord
}

func New(
	ctx context.Context,
	bus *eventbus.Bus,
	db *database.Database,
	identity Identity,
	userSettings *usersettings.Store,
	config config.Config,
	logger logging.Logger,
) (*Service, error) {
	if logger == nil {
		logger = logging.NewNop()
	}

	service := &Service{
		cleanupInterval: time.Duration(config.SubscriptionCleanupHours) * time.Hour,
		db:              db,
		identity:        identity,
		logger:          logger,
		subscribers:     make(map[string]map[string]time.Time),
		snapshots:       make(map[string]publishedSnapshot),
		userSettings:    userSettings,
	}

	if err := service.migrate(ctx); err != nil {
		return nil, err
	}

	unregisterRPC := bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"addUserSubscription":              service.addUserSubscription,
		"fetchUserSubscriptions":           service.fetchUserSubscriptions,
		"getPublishedSubscriptionCode":     service.getPublishedSubscriptionCode,
		"removeUserSubscription":           service.removeUserSubscription,
		"revokePublishedSubscriptionCode":  service.revokePublishedSubscriptionCode,
		"setSubscribedTriggerEnablement":   service.setSubscribedTriggerEnablement,
		"setSubscriptionDefaultEnablement": service.setSubscriptionDefaultEnablement,
		"syncSubscriptions":                service.syncSubscriptions,
	})
	unregisterUserUpdates := bus.Listen("user.*", service.handleUserMessage)
	unregisterSubscriberMessages := bus.Listen("sub.*", service.handleSubscriberMessage(bus))
	service.unregister = func() {
		unregisterRPC()
		unregisterUserUpdates()
		unregisterSubscriberMessages()
	}

	return service, nil
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (service *Service) StartCleanup(ctx context.Context) {
	if err := service.Cleanup(ctx); err != nil {
		return
	}

	ticker := time.NewTicker(service.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = service.Cleanup(ctx)
		}
	}
}

func (service *Service) Cleanup(ctx context.Context) error {
	statements := []string{
		"DELETE FROM user_subscriptions WHERE subscription_id NOT IN (SELECT subscription_id FROM publisher_subscriptions)",
		`
			DELETE FROM user_subscription_default_enablement
			WHERE NOT EXISTS (
				SELECT 1
				FROM user_subscriptions us
				WHERE us.user_id = user_subscription_default_enablement.user_id
					AND us.subscription_id = user_subscription_default_enablement.subscription_id
			)
		`,
		`
			DELETE FROM user_subscription_trigger_enablement
			WHERE NOT EXISTS (
				SELECT 1
				FROM user_subscriptions us
				WHERE us.user_id = user_subscription_trigger_enablement.user_id
					AND us.subscription_id = user_subscription_trigger_enablement.subscription_id
			)
		`,
		`
			DELETE FROM user_subscription_trigger_enablement
			WHERE NOT EXISTS (
				SELECT 1
				FROM publisher_subscriptions ps
				JOIN user_triggers ut ON ut.user_id = ps.user_id
					AND ut.trigger_id = user_subscription_trigger_enablement.trigger_id
					AND ut.deleted = 0
					AND ut.publish = 1
				WHERE ps.subscription_id = user_subscription_trigger_enablement.subscription_id
			)
		`,
	}

	for _, statement := range statements {
		if _, err := service.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("cleanup subscriptions: %w", err)
		}
	}

	service.clearSnapshotCache(ctx, "cleanup")

	return nil
}

func (service *Service) migrate(ctx context.Context) error {
	statements := []string{
		`
			CREATE TABLE IF NOT EXISTS publisher_subscriptions (
				user_id TEXT PRIMARY KEY,
				subscription_id TEXT NOT NULL UNIQUE,
				created_at_ms INTEGER NOT NULL,
				updated_at_ms INTEGER NOT NULL,
				FOREIGN KEY (user_id) REFERENCES auth_users(id)
			)
		`,
		`
			CREATE TABLE IF NOT EXISTS user_subscriptions (
				user_id TEXT NOT NULL,
				subscription_id TEXT NOT NULL,
				created_at_ms INTEGER NOT NULL,
				updated_at_ms INTEGER NOT NULL,
				PRIMARY KEY (user_id, subscription_id),
				FOREIGN KEY (user_id) REFERENCES auth_users(id)
			)
		`,
		`
			CREATE TABLE IF NOT EXISTS user_subscription_default_enablement (
				user_id TEXT NOT NULL,
				subscription_id TEXT NOT NULL,
				character_name TEXT NOT NULL,
				server_name TEXT NOT NULL,
				mode TEXT NOT NULL CHECK (mode IN ('enabled', 'disabled')),
				updated_at_ms INTEGER NOT NULL,
				PRIMARY KEY (user_id, subscription_id, character_name, server_name)
			)
		`,
		`
			CREATE TABLE IF NOT EXISTS user_subscription_trigger_enablement (
				user_id TEXT NOT NULL,
				subscription_id TEXT NOT NULL,
				trigger_id TEXT NOT NULL,
				character_name TEXT NOT NULL,
				server_name TEXT NOT NULL,
				mode TEXT NOT NULL CHECK (mode IN ('enabled', 'disabled')),
				updated_at_ms INTEGER NOT NULL,
				PRIMARY KEY (user_id, subscription_id, trigger_id, character_name, server_name)
			)
		`,
		"CREATE INDEX IF NOT EXISTS idx_user_subscriptions_subscription_id ON user_subscriptions(subscription_id)",
		"CREATE INDEX IF NOT EXISTS idx_subscription_trigger_enablement_subscription_trigger ON user_subscription_trigger_enablement(subscription_id, trigger_id)",
	}

	for _, statement := range statements {
		if _, err := service.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("migrate subscriptions: %w", err)
		}
	}

	return nil
}

func (service *Service) getPublishedSubscriptionCode(ctx context.Context, metadata eventbus.RPCMetadata, _ json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	subscriptionID, err := service.getOrCreateSubscriptionID(ctx, userID)
	if err != nil {
		return nil, err
	}

	return GetPublishedSubscriptionCodeResponse{
		Code: "{JENA:sub:" + subscriptionID + "}",
		ID:   subscriptionID,
	}, nil
}

func (service *Service) revokePublishedSubscriptionCode(ctx context.Context, metadata eventbus.RPCMetadata, _ json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	if _, err := service.db.ExecContext(
		ctx,
		"DELETE FROM publisher_subscriptions WHERE user_id = ?",
		userID,
	); err != nil {
		return nil, fmt.Errorf("delete publisher subscription: %w", err)
	}

	service.invalidatePublisherSnapshot(ctx, userID, "publisher subscription revoked")

	return struct{}{}, nil
}

func (service *Service) syncSubscriptions(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	var request SyncSubscriptionsRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode sync subscriptions request: %w", err)
	}

	requestingUserID, _ := service.authenticate(ctx, metadata)

	results := make([]SyncSubscriptionsResult, 0, len(request.Subscriptions))
	seen := make(map[string]struct{}, len(request.Subscriptions))
	for _, requested := range request.Subscriptions {
		subscriptionID, ok := normalizeSubscriptionID(requested.ID)
		if !ok {
			service.logger.Trace(
				ctx,
				"subscription sync subscription rejected",
				logging.String("subscriptionId", requested.ID),
				logging.String("reason", "invalid subscription id"),
			)
			results = append(results, SyncSubscriptionsResult{
				ID:     requested.ID,
				Status: "notFound",
			})
			continue
		}
		if _, exists := seen[subscriptionID]; exists {
			continue
		}
		seen[subscriptionID] = struct{}{}

		publisherUserID, found, err := service.publisherUserIDForSubscription(ctx, subscriptionID)
		if err != nil {
			return nil, err
		}
		if !found {
			service.logger.Trace(
				ctx,
				"subscription sync subscription not found",
				logging.String("subscriptionId", subscriptionID),
				logging.String("requestedDigest", requested.Digest),
			)
			results = append(results, SyncSubscriptionsResult{
				ID:     subscriptionID,
				Status: "notFound",
			})
			continue
		}

		if requestingUserID != "" && requestingUserID == publisherUserID {
			results = append(results, SyncSubscriptionsResult{
				ID:     subscriptionID,
				Status: "notFound",
			})
			continue
		}

		service.rememberSubscriberSource(publisherUserID, metadata.Sender, time.Now())

		snapshot, err := service.publishedSnapshotForUser(ctx, publisherUserID)
		if err != nil {
			return nil, err
		}
		if requested.Digest == snapshot.digest {
			service.logger.Trace(
				ctx,
				"subscription sync digest matched",
				logging.String("subscriptionId", subscriptionID),
				logging.String("publisherUserId", publisherUserID),
				logging.String("requestedDigest", requested.Digest),
				logging.String("currentDigest", snapshot.digest),
				logging.Int("recordCount", len(snapshot.records)),
			)
			results = append(results, SyncSubscriptionsResult{
				Digest:           snapshot.digest,
				ID:               subscriptionID,
				OwnerDisplayName: snapshot.ownerDisplayName,
				Status:           "current",
			})
			continue
		}

		service.logger.Trace(
			ctx,
			"subscription sync digest changed",
			logging.String("subscriptionId", subscriptionID),
			logging.String("publisherUserId", publisherUserID),
			logging.String("requestedDigest", requested.Digest),
			logging.String("currentDigest", snapshot.digest),
			logging.Int("recordCount", len(snapshot.records)),
		)
		results = append(results, SyncSubscriptionsResult{
			Digest:           snapshot.digest,
			ID:               subscriptionID,
			OwnerDisplayName: snapshot.ownerDisplayName,
			Records:          snapshot.records,
			Status:           "updated",
		})
	}

	return SyncSubscriptionsResponse{
		Subscriptions: results,
	}, nil
}

func (service *Service) fetchUserSubscriptions(ctx context.Context, metadata eventbus.RPCMetadata, _ json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	subscriptions, err := service.fetchUserSubscriptionIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	defaultEnablement, err := service.fetchDefaultEnablement(ctx, userID)
	if err != nil {
		return nil, err
	}
	triggerEnablement, err := service.fetchTriggerEnablement(ctx, userID)
	if err != nil {
		return nil, err
	}

	return FetchUserSubscriptionsResponse{
		DefaultEnablement: defaultEnablement,
		Subscriptions:     subscriptions,
		TriggerEnablement: triggerEnablement,
	}, nil
}

func (service *Service) addUserSubscription(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request SubscriptionIDRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode add user subscription request: %w", err)
	}
	subscriptionID, ok := normalizeSubscriptionID(request.SubscriptionID)
	if !ok {
		return nil, errors.New("subscriptionId must be a UUID")
	}
	if err := service.ensureFollowedSubscription(ctx, userID, subscriptionID); err != nil {
		return nil, err
	}

	return struct{}{}, nil
}

func (service *Service) removeUserSubscription(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request SubscriptionIDRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode remove user subscription request: %w", err)
	}
	subscriptionID, ok := normalizeSubscriptionID(request.SubscriptionID)
	if !ok {
		return nil, errors.New("subscriptionId must be a UUID")
	}

	statements := []string{
		"DELETE FROM user_subscription_trigger_enablement WHERE user_id = ? AND subscription_id = ?",
		"DELETE FROM user_subscription_default_enablement WHERE user_id = ? AND subscription_id = ?",
		"DELETE FROM user_subscriptions WHERE user_id = ? AND subscription_id = ?",
	}
	for _, statement := range statements {
		if _, err := service.db.ExecContext(ctx, statement, userID, subscriptionID); err != nil {
			return nil, fmt.Errorf("remove user subscription: %w", err)
		}
	}

	return struct{}{}, nil
}

func (service *Service) setSubscriptionDefaultEnablement(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request SetSubscriptionDefaultEnablementRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode subscription default enablement request: %w", err)
	}
	subscriptionID, ok := normalizeSubscriptionID(request.SubscriptionID)
	if !ok {
		return nil, errors.New("subscriptionId must be a UUID")
	}
	if request.Mode != defaultEnablementEnabled && request.Mode != defaultEnablementDisabled {
		return nil, errors.New("mode must be enabled or disabled")
	}
	if err := service.ensureFollowedSubscription(ctx, userID, subscriptionID); err != nil {
		return nil, err
	}

	_, err = service.db.ExecContext(
		ctx,
		`
			INSERT INTO user_subscription_default_enablement (
				user_id,
				subscription_id,
				character_name,
				server_name,
				mode,
				updated_at_ms
			)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, subscription_id, character_name, server_name) DO UPDATE SET
				mode = excluded.mode,
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		subscriptionID,
		request.Character.CharacterName,
		request.Character.ServerName,
		request.Mode,
		time.Now().UnixMilli(),
	)
	if err != nil {
		return nil, fmt.Errorf("set subscription default enablement: %w", err)
	}

	return struct{}{}, nil
}

func (service *Service) setSubscribedTriggerEnablement(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	userID, err := service.authenticate(ctx, metadata)
	if err != nil {
		return nil, err
	}

	var request SetSubscribedTriggerEnablementRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode subscribed trigger enablement request: %w", err)
	}
	subscriptionID, ok := normalizeSubscriptionID(request.SubscriptionID)
	if !ok {
		return nil, errors.New("subscriptionId must be a UUID")
	}
	if request.Mode != triggerEnablementEnabled && request.Mode != triggerEnablementDisabled && request.Mode != triggerEnablementInherit {
		return nil, errors.New("mode must be enabled, disabled, or inherit")
	}
	if err := service.ensureFollowedSubscription(ctx, userID, subscriptionID); err != nil {
		return nil, err
	}

	if request.Mode == triggerEnablementInherit {
		if _, err := service.db.ExecContext(
			ctx,
			`
				DELETE FROM user_subscription_trigger_enablement
				WHERE user_id = ?
					AND subscription_id = ?
					AND trigger_id = ?
					AND character_name = ?
					AND server_name = ?
			`,
			userID,
			subscriptionID,
			request.TriggerID,
			request.Character.CharacterName,
			request.Character.ServerName,
		); err != nil {
			return nil, fmt.Errorf("clear subscribed trigger enablement: %w", err)
		}

		return struct{}{}, nil
	}

	_, err = service.db.ExecContext(
		ctx,
		`
			INSERT INTO user_subscription_trigger_enablement (
				user_id,
				subscription_id,
				trigger_id,
				character_name,
				server_name,
				mode,
				updated_at_ms
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, subscription_id, trigger_id, character_name, server_name) DO UPDATE SET
				mode = excluded.mode,
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		subscriptionID,
		request.TriggerID,
		request.Character.CharacterName,
		request.Character.ServerName,
		request.Mode,
		time.Now().UnixMilli(),
	)
	if err != nil {
		return nil, fmt.Errorf("set subscribed trigger enablement: %w", err)
	}

	return struct{}{}, nil
}

func (service *Service) authenticate(ctx context.Context, metadata eventbus.RPCMetadata) (string, error) {
	if service.identity == nil {
		return "", errors.New("auth identity resolver is not configured")
	}

	return service.identity.StableIDForAuthToken(ctx, &metadata.AuthToken)
}

func (service *Service) getOrCreateSubscriptionID(ctx context.Context, userID string) (string, error) {
	for range 3 {
		subscriptionID := uuid.NewString()
		nowMs := time.Now().UnixMilli()
		if _, err := service.db.ExecContext(
			ctx,
			`
				INSERT OR IGNORE INTO publisher_subscriptions (
					user_id,
					subscription_id,
					created_at_ms,
					updated_at_ms
				)
				VALUES (?, ?, ?, ?)
			`,
			userID,
			subscriptionID,
			nowMs,
			nowMs,
		); err != nil {
			return "", fmt.Errorf("insert publisher subscription: %w", err)
		}

		var storedSubscriptionID string
		err := service.db.QueryRowContext(
			ctx,
			"SELECT subscription_id FROM publisher_subscriptions WHERE user_id = ?",
			userID,
		).Scan(&storedSubscriptionID)
		if err == nil {
			return storedSubscriptionID, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("lookup publisher subscription: %w", err)
		}
	}

	return "", errors.New("failed to create publisher subscription")
}

func (service *Service) publisherUserIDForSubscription(ctx context.Context, subscriptionID string) (string, bool, error) {
	var userID string
	err := service.db.QueryRowContext(
		ctx,
		"SELECT user_id FROM publisher_subscriptions WHERE subscription_id = ?",
		subscriptionID,
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("lookup publisher subscription owner: %w", err)
	}

	return userID, true, nil
}

func (service *Service) publishedSnapshotForUser(ctx context.Context, userID string) (publishedSnapshot, error) {
	service.snapshotMu.Lock()
	cached, ok := service.snapshots[userID]
	service.snapshotMu.Unlock()
	if ok {
		displayName, err := service.displayNameForUser(ctx, userID)
		if err != nil {
			return publishedSnapshot{}, err
		}
		cached.ownerDisplayName = displayName
		service.logger.Trace(
			ctx,
			"subscription snapshot cache hit",
			logging.String("publisherUserId", userID),
			logging.String("digest", cached.digest),
			logging.Int("recordCount", len(cached.records)),
		)
		return cached, nil
	}

	records, err := service.fetchPublishedRecords(ctx, userID)
	if err != nil {
		return publishedSnapshot{}, err
	}
	displayName, err := service.displayNameForUser(ctx, userID)
	if err != nil {
		return publishedSnapshot{}, err
	}

	snapshot := publishedSnapshot{
		digest:           digestPublishedRecords(records),
		ownerDisplayName: displayName,
		records:          records,
	}
	service.logger.Trace(
		ctx,
		"subscription snapshot computed",
		logging.String("publisherUserId", userID),
		logging.String("digest", snapshot.digest),
		logging.Int("recordCount", len(snapshot.records)),
	)

	service.snapshotMu.Lock()
	service.snapshots[userID] = snapshot
	service.snapshotMu.Unlock()

	return snapshot, nil
}

func (service *Service) displayNameForUser(ctx context.Context, userID string) (string, error) {
	if service.userSettings == nil {
		return userID, nil
	}

	displayName, err := service.userSettings.DisplayNameForUser(ctx, userID)
	if err != nil {
		return "", err
	}

	return displayName, nil
}

func (service *Service) fetchPublishedRecords(ctx context.Context, userID string) ([]SubscriptionTriggerRecord, error) {
	rows, err := service.db.QueryContext(
		ctx,
		`
			SELECT trigger_id, broadcast_mode
			FROM user_triggers
			WHERE user_id = ?
				AND deleted = 0
				AND publish = 1
			ORDER BY trigger_id
		`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch published subscription triggers: %w", err)
	}
	defer rows.Close()

	records := make([]SubscriptionTriggerRecord, 0)
	for rows.Next() {
		var triggerID model.TriggerID
		var broadcastMode model.BroadcastMode
		if err := rows.Scan(&triggerID, &broadcastMode); err != nil {
			return nil, fmt.Errorf("scan published subscription trigger: %w", err)
		}

		records = append(records, SubscriptionTriggerRecord{
			BroadcastToSubscribers: broadcastMode == model.BroadcastModeSubscribers,
			TriggerID:              triggerID,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate published subscription triggers: %w", err)
	}

	return records, nil
}

func (service *Service) fetchUserSubscriptionIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := service.db.QueryContext(
		ctx,
		`
			SELECT us.subscription_id
			FROM user_subscriptions us
			JOIN publisher_subscriptions ps ON ps.subscription_id = us.subscription_id
			WHERE us.user_id = ?
			ORDER BY us.subscription_id
		`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch user subscriptions: %w", err)
	}
	defer rows.Close()

	subscriptions := make([]string, 0)
	for rows.Next() {
		var subscriptionID string
		if err := rows.Scan(&subscriptionID); err != nil {
			return nil, fmt.Errorf("scan user subscription: %w", err)
		}
		subscriptions = append(subscriptions, subscriptionID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user subscriptions: %w", err)
	}

	return subscriptions, nil
}

func (service *Service) fetchDefaultEnablement(ctx context.Context, userID string) ([]SubscriptionDefaultEnablementRecord, error) {
	rows, err := service.db.QueryContext(
		ctx,
		`
			SELECT subscription_id, character_name, server_name, mode
			FROM user_subscription_default_enablement
			WHERE user_id = ?
			ORDER BY subscription_id, character_name, server_name
		`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch subscription default enablement: %w", err)
	}
	defer rows.Close()

	records := make([]SubscriptionDefaultEnablementRecord, 0)
	for rows.Next() {
		var record SubscriptionDefaultEnablementRecord
		if err := rows.Scan(
			&record.SubscriptionID,
			&record.Character.CharacterName,
			&record.Character.ServerName,
			&record.Mode,
		); err != nil {
			return nil, fmt.Errorf("scan subscription default enablement: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscription default enablement: %w", err)
	}

	return records, nil
}

func (service *Service) fetchTriggerEnablement(ctx context.Context, userID string) ([]SubscriptionTriggerEnablementRecord, error) {
	rows, err := service.db.QueryContext(
		ctx,
		`
			SELECT subscription_id, trigger_id, character_name, server_name, mode
			FROM user_subscription_trigger_enablement
			WHERE user_id = ?
			ORDER BY subscription_id, trigger_id, character_name, server_name
		`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch subscribed trigger enablement: %w", err)
	}
	defer rows.Close()

	records := make([]SubscriptionTriggerEnablementRecord, 0)
	for rows.Next() {
		var record SubscriptionTriggerEnablementRecord
		if err := rows.Scan(
			&record.SubscriptionID,
			&record.TriggerID,
			&record.Character.CharacterName,
			&record.Character.ServerName,
			&record.Mode,
		); err != nil {
			return nil, fmt.Errorf("scan subscribed trigger enablement: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscribed trigger enablement: %w", err)
	}

	return records, nil
}

func (service *Service) ensureFollowedSubscription(ctx context.Context, userID string, subscriptionID string) error {
	nowMs := time.Now().UnixMilli()
	_, err := service.db.ExecContext(
		ctx,
		`
			INSERT INTO user_subscriptions (
				user_id,
				subscription_id,
				created_at_ms,
				updated_at_ms
			)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(user_id, subscription_id) DO UPDATE SET
				updated_at_ms = excluded.updated_at_ms
		`,
		userID,
		subscriptionID,
		nowMs,
		nowMs,
	)
	if err != nil {
		return fmt.Errorf("store user subscription: %w", err)
	}

	return nil
}

func (service *Service) handleUserMessage(ctx context.Context, envelope eventbus.Envelope) {
	userID := userIDFromUserDestination(envelope.Destination)
	if userID == "" {
		return
	}

	service.invalidatePublisherSnapshot(ctx, userID, "user-targeted update")
}

func (service *Service) handleSubscriberMessage(bus *eventbus.Bus) eventbus.Listener {
	return func(ctx context.Context, envelope eventbus.Envelope) {
		userID, destination, ok := parseSubscriberDestination(envelope.Destination)
		if !ok {
			return
		}

		for _, source := range service.activeSubscriberSources(userID, time.Now()) {
			outbound := envelope
			outbound.Destination = source + "." + destination
			_ = bus.Send(ctx, outbound)
		}
	}
}

func (service *Service) rememberSubscriberSource(userID string, sender string, now time.Time) {
	source, ok := websocketSourcePrefix(sender)
	if !ok || userID == "" {
		return
	}

	service.subscriberMu.Lock()
	defer service.subscriberMu.Unlock()

	sources := service.subscribers[userID]
	if sources == nil {
		sources = make(map[string]time.Time)
		service.subscribers[userID] = sources
	}
	sources[source] = now
	service.pruneSubscriberSourcesLocked(userID, now)
}

func (service *Service) activeSubscriberSources(userID string, now time.Time) []string {
	service.subscriberMu.Lock()
	defer service.subscriberMu.Unlock()

	service.pruneSubscriberSourcesLocked(userID, now)
	sourcesByLastSeen := service.subscribers[userID]
	if len(sourcesByLastSeen) == 0 {
		return nil
	}

	sources := make([]string, 0, len(sourcesByLastSeen))
	for source := range sourcesByLastSeen {
		sources = append(sources, source)
	}
	sort.Strings(sources)

	return sources
}

func (service *Service) pruneSubscriberSourcesLocked(userID string, now time.Time) {
	sources := service.subscribers[userID]
	if len(sources) == 0 {
		delete(service.subscribers, userID)
		return
	}

	expiresBefore := now.Add(-subscriberSourceTTL)
	for source, lastSeen := range sources {
		if lastSeen.Before(expiresBefore) {
			delete(sources, source)
		}
	}
	if len(sources) == 0 {
		delete(service.subscribers, userID)
	}
}

func (service *Service) invalidatePublisherSnapshot(ctx context.Context, userID string, reason string) {
	service.snapshotMu.Lock()
	_, hadCachedSnapshot := service.snapshots[userID]
	delete(service.snapshots, userID)
	service.snapshotMu.Unlock()

	service.logger.Trace(
		ctx,
		"subscription snapshot cache invalidated",
		logging.String("userId", userID),
		logging.String("reason", reason),
		logging.Bool("hadCachedSnapshot", hadCachedSnapshot),
	)
}

func (service *Service) clearSnapshotCache(ctx context.Context, reason string) {
	service.snapshotMu.Lock()
	cachedSnapshotCount := len(service.snapshots)
	service.snapshots = make(map[string]publishedSnapshot)
	service.snapshotMu.Unlock()

	service.logger.Trace(
		ctx,
		"subscription snapshot cache cleared",
		logging.String("reason", reason),
		logging.Int("cachedSnapshotCount", cachedSnapshotCount),
	)
}

func normalizeSubscriptionID(value string) (string, bool) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}

	return parsed.String(), true
}

func digestPublishedRecords(records []SubscriptionTriggerRecord) string {
	canonical := append([]SubscriptionTriggerRecord(nil), records...)
	sort.Slice(canonical, func(left int, right int) bool {
		return canonical[left].TriggerID < canonical[right].TriggerID
	})

	hasher := sha256.New()
	_, _ = hasher.Write([]byte("jena-subscription-records:v1\n"))
	for _, record := range canonical {
		_, _ = hasher.Write([]byte(record.TriggerID))
		_, _ = hasher.Write([]byte{0})
		if record.BroadcastToSubscribers {
			_, _ = hasher.Write([]byte("1\n"))
		} else {
			_, _ = hasher.Write([]byte("0\n"))
		}
	}

	return hex.EncodeToString(hasher.Sum(nil))
}

func userIDFromUserDestination(destination string) string {
	remainder, ok := strings.CutPrefix(destination, "user.")
	if !ok {
		return ""
	}

	userID, _, ok := strings.Cut(remainder, ".")
	if !ok || userID == "" {
		return ""
	}

	return userID
}

func parseSubscriberDestination(destination string) (string, string, bool) {
	remainder, ok := strings.CutPrefix(destination, "sub.")
	if !ok {
		return "", "", false
	}

	userID, forwardedDestination, ok := strings.Cut(remainder, ".")
	userID = strings.TrimSpace(userID)
	forwardedDestination = strings.TrimSpace(forwardedDestination)
	if !ok || userID == "" || forwardedDestination == "" {
		return "", "", false
	}

	return userID, forwardedDestination, true
}

func websocketSourcePrefix(source string) (string, bool) {
	remainder, ok := strings.CutPrefix(source, "ws.")
	if !ok {
		return "", false
	}

	connection, _, ok := strings.Cut(remainder, ".")
	if !ok || connection == "" {
		return "", false
	}

	return "ws." + connection, true
}
