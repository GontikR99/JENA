package sharingservice

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/triggerstore"
	"jena/backend/internal/usersettings"
	"jena/backend/model"
)

const endpoint = "sharing"
const anonymousDisplayName = "An anonymous user"

var shareCodePattern = regexp.MustCompile(`(?i)^\{JENA:share:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}$`)

type Service struct {
	cleanupInterval time.Duration
	db              *database.Database
	identity        Identity
	packageTTL      time.Duration
	triggerStore    *triggerstore.Service
	unregister      func()
	userSettings    *usersettings.Store
}

type Identity interface {
	StableIDForAuthToken(context.Context, *string) (string, error)
}

type CreateSharePackageRequest struct {
	TriggerIDs []model.TriggerID `json:"triggerIds"`
}

type CreateSharePackageResponse struct {
	Code       string            `json:"code"`
	ExpiresAt  string            `json:"expiresAt"`
	ID         string            `json:"id"`
	TriggerIDs []model.TriggerID `json:"triggerIds"`
}

type ResolveSharePackageRequest struct {
	Code string `json:"code"`
}

type ResolveSharePackageResponse struct {
	CreatorDisplayName string            `json:"creatorDisplayName"`
	ExpiresAt          string            `json:"expiresAt"`
	TriggerIDs         []model.TriggerID `json:"triggerIds"`
}

func New(
	ctx context.Context,
	bus *eventbus.Bus,
	db *database.Database,
	identity Identity,
	triggerStore *triggerstore.Service,
	userSettings *usersettings.Store,
	config config.Config,
) (*Service, error) {
	service := &Service{
		cleanupInterval: time.Duration(config.SharePackageCleanupMinutes) * time.Minute,
		db:              db,
		identity:        identity,
		packageTTL:      time.Duration(config.SharePackageTTLMins) * time.Minute,
		triggerStore:    triggerStore,
		userSettings:    userSettings,
	}

	if err := service.migrate(ctx); err != nil {
		return nil, err
	}

	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"createSharePackage":  service.createSharePackage,
		"resolveSharePackage": service.resolveSharePackage,
	})

	return service, nil
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (service *Service) StartCleanup(ctx context.Context) {
	ticker := time.NewTicker(service.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = service.DeleteExpired(ctx)
		}
	}
}

func (service *Service) DeleteExpired(ctx context.Context) error {
	_, err := service.db.ExecContext(
		ctx,
		"DELETE FROM share_packages WHERE expires_at_ms <= ?",
		time.Now().UnixMilli(),
	)
	if err != nil {
		return fmt.Errorf("delete expired share packages: %w", err)
	}

	return nil
}

func (service *Service) migrate(ctx context.Context) error {
	if _, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS share_packages (
			id TEXT PRIMARY KEY,
			creator_user_id TEXT,
			created_at_ms INTEGER NOT NULL,
			expires_at_ms INTEGER NOT NULL,
			FOREIGN KEY (creator_user_id) REFERENCES auth_users(id)
		)
	`); err != nil {
		return fmt.Errorf("migrate share packages: %w", err)
	}

	if _, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS share_package_triggers (
			package_id TEXT NOT NULL,
			trigger_id TEXT NOT NULL,
			PRIMARY KEY (package_id, trigger_id),
			FOREIGN KEY (package_id) REFERENCES share_packages(id) ON DELETE CASCADE,
			FOREIGN KEY (trigger_id) REFERENCES triggers(id)
		)
	`); err != nil {
		return fmt.Errorf("migrate share package triggers: %w", err)
	}

	return nil
}

func (service *Service) createSharePackage(ctx context.Context, metadata eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	var request CreateSharePackageRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode create share package request: %w", err)
	}

	triggerIDs, err := service.triggerStore.FilterStoredTriggerIDs(ctx, request.TriggerIDs)
	if err != nil {
		return nil, err
	}
	if len(triggerIDs) == 0 {
		return nil, errors.New("share package requires at least one stored trigger")
	}

	var creatorUserID *string
	if strings.TrimSpace(metadata.AuthToken) != "" {
		if userID, err := service.identity.StableIDForAuthToken(ctx, &metadata.AuthToken); err == nil {
			creatorUserID = &userID
		}
	}

	now := time.Now()
	expiresAt := now.Add(service.packageTTL)
	id := uuid.NewString()

	tx, err := service.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin share package creation: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(
		ctx,
		`
			INSERT INTO share_packages (
				id,
				creator_user_id,
				created_at_ms,
				expires_at_ms
			)
			VALUES (?, ?, ?, ?)
		`,
		id,
		creatorUserID,
		now.UnixMilli(),
		expiresAt.UnixMilli(),
	); err != nil {
		return nil, fmt.Errorf("insert share package: %w", err)
	}

	for _, triggerID := range triggerIDs {
		if _, err := tx.ExecContext(
			ctx,
			`
				INSERT INTO share_package_triggers (package_id, trigger_id)
				VALUES (?, ?)
			`,
			id,
			string(triggerID),
		); err != nil {
			return nil, fmt.Errorf("insert share package trigger: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit share package creation: %w", err)
	}

	return CreateSharePackageResponse{
		Code:       "{JENA:share:" + id + "}",
		ExpiresAt:  expiresAt.UTC().Format(time.RFC3339),
		ID:         id,
		TriggerIDs: triggerIDs,
	}, nil
}

func (service *Service) resolveSharePackage(ctx context.Context, _ eventbus.RPCMetadata, params json.RawMessage) (any, error) {
	var request ResolveSharePackageRequest
	if err := json.Unmarshal(params, &request); err != nil {
		return nil, fmt.Errorf("decode resolve share package request: %w", err)
	}

	id, err := parseShareCode(request.Code)
	if err != nil {
		return nil, err
	}

	var creatorUserID sql.NullString
	var expiresAtMs int64
	err = service.db.QueryRowContext(
		ctx,
		`
			SELECT creator_user_id, expires_at_ms
			FROM share_packages
			WHERE id = ?
		`,
		id,
	).Scan(&creatorUserID, &expiresAtMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("share package not found")
	}
	if err != nil {
		return nil, fmt.Errorf("lookup share package: %w", err)
	}
	if expiresAtMs <= time.Now().UnixMilli() {
		return nil, errors.New("share package expired")
	}

	rows, err := service.db.QueryContext(
		ctx,
		`
			SELECT trigger_id
			FROM share_package_triggers
			WHERE package_id = ?
			ORDER BY trigger_id
		`,
		id,
	)
	if err != nil {
		return nil, fmt.Errorf("lookup share package triggers: %w", err)
	}
	defer rows.Close()

	triggerIDs := []model.TriggerID{}
	for rows.Next() {
		var triggerID model.TriggerID
		if err := rows.Scan(&triggerID); err != nil {
			return nil, fmt.Errorf("scan share package trigger: %w", err)
		}
		triggerIDs = append(triggerIDs, triggerID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lookup share package trigger rows: %w", err)
	}

	creatorDisplayName := anonymousDisplayName
	if creatorUserID.Valid && strings.TrimSpace(creatorUserID.String) != "" {
		displayName, err := service.userSettings.DisplayNameForUser(ctx, creatorUserID.String)
		if err != nil {
			return nil, err
		}
		creatorDisplayName = displayName
	}

	return ResolveSharePackageResponse{
		CreatorDisplayName: creatorDisplayName,
		ExpiresAt:          time.UnixMilli(expiresAtMs).UTC().Format(time.RFC3339),
		TriggerIDs:         triggerIDs,
	}, nil
}

func parseShareCode(value string) (string, error) {
	trimmedValue := strings.TrimSpace(value)
	if _, err := uuid.Parse(trimmedValue); err == nil {
		return strings.ToLower(trimmedValue), nil
	}

	matches := shareCodePattern.FindStringSubmatch(trimmedValue)
	if len(matches) != 2 {
		return "", errors.New("share code is invalid")
	}

	id, err := uuid.Parse(matches[1])
	if err != nil {
		return "", errors.New("share code is invalid")
	}

	return strings.ToLower(id.String()), nil
}
