package authservice

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
	"jena/backend/internal/usersettings"
)

const (
	endpoint = "auth"

	discordAuthorizeURL = "https://discord.com/oauth2/authorize"
	discordTokenURL     = "https://discord.com/api/oauth2/token"
	discordCurrentUser  = "https://discord.com/api/users/@me"

	discordScope = "identify"

	callbackPath = "/_jena/auth/discord/callback"
	loginPath    = "/_jena/auth/discord/login"
	logoutPath   = "/_jena/auth/logout"
	statePath    = "/_jena/auth/discord"

	oauthStateCookieName = "jena_oauth_state"
	oauthStateMaxAge     = 10 * time.Minute
)

type Service struct {
	client        *http.Client
	config        config.Config
	db            *database.Database
	logger        logging.Logger
	unregister    func()
	sessionMaxAge time.Duration
	userSettings  *usersettings.Store
}

type SessionUser struct {
	AvatarURL  string `json:"avatarUrl,omitempty"`
	DiscordID  string `json:"discordId"`
	GlobalName string `json:"globalName,omitempty"`
	ID         string `json:"id"`
	Username   string `json:"username"`
}

type SessionResponse struct {
	Status       string                 `json:"status"`
	User         *SessionUser           `json:"user,omitempty"`
	UserSettings *usersettings.Settings `json:"userSettings,omitempty"`
}

type discordTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

type discordUserResponse struct {
	Avatar     *string `json:"avatar"`
	GlobalName *string `json:"global_name"`
	ID         string  `json:"id"`
	Username   string  `json:"username"`
}

func New(
	ctx context.Context,
	bus *eventbus.Bus,
	db *database.Database,
	config config.Config,
	logger logging.Logger,
	userSettings *usersettings.Store,
) (*Service, error) {
	service := &Service{
		client:        http.DefaultClient,
		config:        config,
		db:            db,
		logger:        logger,
		sessionMaxAge: time.Duration(config.AuthSessionDays) * 24 * time.Hour,
		userSettings:  userSettings,
	}

	if err := service.migrate(ctx); err != nil {
		return nil, err
	}

	service.unregister = bus.RegisterRPC(endpoint, map[string]eventbus.RPCHandler{
		"getSession": service.getSession,
	})

	return service, nil
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (service *Service) LoginPath() string {
	return loginPath
}

func (service *Service) CallbackPath() string {
	return callbackPath
}

func (service *Service) LogoutPath() string {
	return logoutPath
}

func (service *Service) ServeLogin(response http.ResponseWriter, request *http.Request) {
	if !service.isDiscordConfigured() {
		http.Error(response, "Discord OAuth is not configured", http.StatusServiceUnavailable)
		return
	}

	state, err := randomToken(32)
	if err != nil {
		http.Error(response, "failed to create OAuth state", http.StatusInternalServerError)
		return
	}

	baseURL := service.publicBaseURL(request)
	redirectURI := baseURL + callbackPath
	authorizeURL, err := url.Parse(discordAuthorizeURL)
	if err != nil {
		http.Error(response, "failed to create Discord authorization URL", http.StatusInternalServerError)
		return
	}

	query := authorizeURL.Query()
	query.Set("client_id", service.config.DiscordClientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("response_type", "code")
	query.Set("scope", discordScope)
	query.Set("state", state)
	authorizeURL.RawQuery = query.Encode()

	http.SetCookie(response, service.oauthStateCookie(request, state, oauthStateMaxAge))
	http.Redirect(response, request, authorizeURL.String(), http.StatusFound)
}

func (service *Service) ServeCallback(response http.ResponseWriter, request *http.Request) {
	if !service.isDiscordConfigured() {
		http.Error(response, "Discord OAuth is not configured", http.StatusServiceUnavailable)
		return
	}

	if err := service.validateOAuthState(request); err != nil {
		service.clearOAuthStateCookie(response, request)
		http.Error(response, err.Error(), http.StatusBadRequest)
		return
	}
	service.clearOAuthStateCookie(response, request)

	code := request.URL.Query().Get("code")
	if strings.TrimSpace(code) == "" {
		http.Error(response, "missing Discord authorization code", http.StatusBadRequest)
		return
	}

	redirectURI := service.publicBaseURL(request) + callbackPath
	token, err := service.exchangeCode(request.Context(), code, redirectURI)
	if err != nil {
		service.logger.Warn(request.Context(), "Discord token exchange failed", logging.Error(err))
		http.Error(response, "Discord token exchange failed", http.StatusBadGateway)
		return
	}

	discordUser, err := service.fetchDiscordUser(request.Context(), token.AccessToken)
	if err != nil {
		service.logger.Warn(request.Context(), "Discord user lookup failed", logging.Error(err))
		http.Error(response, "Discord user lookup failed", http.StatusBadGateway)
		return
	}

	user, err := service.upsertDiscordUser(request.Context(), discordUser)
	if err != nil {
		service.logger.Warn(request.Context(), "auth user upsert failed", logging.Error(err))
		http.Error(response, "failed to store authenticated user", http.StatusInternalServerError)
		return
	}

	sessionToken, err := service.createSession(request.Context(), user.ID)
	if err != nil {
		service.logger.Warn(request.Context(), "auth session creation failed", logging.Error(err))
		http.Error(response, "failed to create authenticated session", http.StatusInternalServerError)
		return
	}

	http.SetCookie(response, service.sessionCookie(request, sessionToken, service.sessionMaxAge))
	http.Redirect(response, request, "/", http.StatusFound)
}

func (service *Service) ServeLogout(response http.ResponseWriter, request *http.Request) {
	cookie, err := request.Cookie(service.config.AuthCookieName)
	if err == nil {
		if err := service.deleteSession(request.Context(), cookie.Value); err != nil {
			service.logger.Warn(request.Context(), "auth session deletion failed", logging.Error(err))
		}
	}

	service.clearSessionCookie(response, request)
	response.WriteHeader(http.StatusNoContent)
}

func (service *Service) StableIDForSessionToken(ctx context.Context, token string) (string, error) {
	user, err := service.UserForSessionToken(ctx, token)
	if err != nil {
		return "", err
	}

	return user.ID, nil
}

func (service *Service) UserIdentityForAuthToken(ctx context.Context, authToken *string) (eventbus.UserIdentity, error) {
	if authToken == nil || strings.TrimSpace(*authToken) == "" {
		return eventbus.UserIdentity{}, errors.New("auth token is required")
	}

	user, err := service.UserForSessionToken(ctx, *authToken)
	if err != nil {
		return eventbus.UserIdentity{}, err
	}

	settings, err := service.userSettings.GetOrDefault(ctx, user.ID, usersettings.Settings{
		DisplayName: user.Username,
	})
	if err != nil {
		return eventbus.UserIdentity{}, err
	}

	return eventbus.UserIdentity{
		DisplayName:  settings.DisplayName,
		Snowflake:    user.DiscordID,
		StableUserID: user.ID,
		Username:     user.Username,
	}, nil
}

func (service *Service) UserForSessionToken(ctx context.Context, token string) (SessionUser, error) {
	if strings.TrimSpace(token) == "" {
		return SessionUser{}, errors.New("auth token is required")
	}

	nowMs := time.Now().UnixMilli()
	var user SessionUser
	var expiresAtMs int64
	err := service.db.QueryRowContext(ctx, `
		SELECT
			u.id,
			u.discord_id,
			u.username,
			COALESCE(u.global_name, ''),
			COALESCE(u.avatar_url, ''),
			s.expires_at_ms
		FROM auth_sessions s
		JOIN auth_users u ON u.id = s.user_id
		WHERE s.token_hash = ?
	`, hashToken(token)).Scan(
		&user.ID,
		&user.DiscordID,
		&user.Username,
		&user.GlobalName,
		&user.AvatarURL,
		&expiresAtMs,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionUser{}, errors.New("auth token is invalid")
	}
	if err != nil {
		return SessionUser{}, fmt.Errorf("lookup auth session: %w", err)
	}
	if expiresAtMs <= nowMs {
		_ = service.deleteSession(ctx, token)
		return SessionUser{}, errors.New("auth token is expired")
	}

	if _, err := service.db.ExecContext(
		ctx,
		"UPDATE auth_sessions SET last_seen_at_ms = ? WHERE token_hash = ?",
		nowMs,
		hashToken(token),
	); err != nil {
		return SessionUser{}, fmt.Errorf("touch auth session: %w", err)
	}

	return user, nil
}

func (service *Service) getSession(ctx context.Context, metadata eventbus.RPCMetadata, _ json.RawMessage) (any, error) {
	user, err := service.UserForSessionToken(ctx, metadata.AuthToken)
	if err != nil {
		return SessionResponse{Status: "anonymous"}, nil
	}

	settings, err := service.userSettings.GetOrDefault(ctx, user.ID, usersettings.Settings{
		DisplayName: user.Username,
	})
	if err != nil {
		return nil, err
	}

	return SessionResponse{
		Status:       "authenticated",
		User:         &user,
		UserSettings: &settings,
	}, nil
}

func (service *Service) migrate(ctx context.Context) error {
	if _, err := service.db.ExecContext(ctx, `
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
		return fmt.Errorf("migrate auth users: %w", err)
	}

	if _, err := service.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS auth_sessions (
			token_hash TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			created_at_ms INTEGER NOT NULL,
			expires_at_ms INTEGER NOT NULL,
			last_seen_at_ms INTEGER NOT NULL,
			FOREIGN KEY (user_id) REFERENCES auth_users(id)
		)
	`); err != nil {
		return fmt.Errorf("migrate auth sessions: %w", err)
	}

	if _, err := service.db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
		ON auth_sessions(user_id)
	`); err != nil {
		return fmt.Errorf("migrate auth session user index: %w", err)
	}

	return nil
}

func (service *Service) exchangeCode(ctx context.Context, code string, redirectURI string) (discordTokenResponse, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", redirectURI)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, discordTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return discordTokenResponse{}, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth(service.config.DiscordClientID, service.config.DiscordClientSecret)

	var token discordTokenResponse
	if err := service.doJSON(request, &token); err != nil {
		return discordTokenResponse{}, err
	}
	if token.AccessToken == "" || !strings.EqualFold(token.TokenType, "Bearer") {
		return discordTokenResponse{}, errors.New("Discord returned an invalid token response")
	}

	return token, nil
}

func (service *Service) fetchDiscordUser(ctx context.Context, accessToken string) (discordUserResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, discordCurrentUser, nil)
	if err != nil {
		return discordUserResponse{}, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)

	var user discordUserResponse
	if err := service.doJSON(request, &user); err != nil {
		return discordUserResponse{}, err
	}
	if user.ID == "" || user.Username == "" {
		return discordUserResponse{}, errors.New("Discord returned an invalid user response")
	}

	return user, nil
}

func (service *Service) doJSON(request *http.Request, value any) error {
	response, err := service.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return fmt.Errorf("Discord returned %s: %s", response.Status, strings.TrimSpace(string(data)))
	}

	if err := json.NewDecoder(response.Body).Decode(value); err != nil {
		return fmt.Errorf("decode Discord response: %w", err)
	}

	return nil
}

func (service *Service) upsertDiscordUser(ctx context.Context, discordUser discordUserResponse) (SessionUser, error) {
	nowMs := time.Now().UnixMilli()
	user := SessionUser{
		AvatarURL:  getDiscordAvatarURL(discordUser),
		DiscordID:  discordUser.ID,
		GlobalName: stringValue(discordUser.GlobalName),
		ID:         "discord:" + discordUser.ID,
		Username:   discordUser.Username,
	}

	_, err := service.db.ExecContext(ctx, `
		INSERT INTO auth_users (
			id,
			discord_id,
			username,
			global_name,
			avatar_url,
			created_at_ms,
			updated_at_ms
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(discord_id) DO UPDATE SET
			username = excluded.username,
			global_name = excluded.global_name,
			avatar_url = excluded.avatar_url,
			updated_at_ms = excluded.updated_at_ms
	`, user.ID, user.DiscordID, user.Username, user.GlobalName, user.AvatarURL, nowMs, nowMs)
	if err != nil {
		return SessionUser{}, fmt.Errorf("upsert auth user: %w", err)
	}

	return user, nil
}

func (service *Service) createSession(ctx context.Context, userID string) (string, error) {
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}

	nowMs := time.Now().UnixMilli()
	expiresAtMs := time.Now().Add(service.sessionMaxAge).UnixMilli()
	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO auth_sessions (
			token_hash,
			user_id,
			created_at_ms,
			expires_at_ms,
			last_seen_at_ms
		)
		VALUES (?, ?, ?, ?, ?)
	`, hashToken(token), userID, nowMs, expiresAtMs, nowMs); err != nil {
		return "", fmt.Errorf("create auth session: %w", err)
	}

	return token, nil
}

func (service *Service) deleteSession(ctx context.Context, token string) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}

	if _, err := service.db.ExecContext(
		ctx,
		"DELETE FROM auth_sessions WHERE token_hash = ?",
		hashToken(token),
	); err != nil {
		return fmt.Errorf("delete auth session: %w", err)
	}

	return nil
}

func (service *Service) validateOAuthState(request *http.Request) error {
	cookie, err := request.Cookie(oauthStateCookieName)
	if err != nil || cookie.Value == "" {
		return errors.New("missing OAuth state cookie")
	}

	state := request.URL.Query().Get("state")
	if state == "" || state != cookie.Value {
		return errors.New("OAuth state mismatch")
	}

	return nil
}

func (service *Service) isDiscordConfigured() bool {
	return service.config.DiscordClientID != "" && service.config.DiscordClientSecret != ""
}

func (service *Service) publicBaseURL(request *http.Request) string {
	if service.config.AuthPublicBaseURL != "" {
		return strings.TrimRight(service.config.AuthPublicBaseURL, "/")
	}

	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	}

	return scheme + "://" + request.Host
}

func (service *Service) sessionCookie(request *http.Request, value string, maxAge time.Duration) *http.Cookie {
	return &http.Cookie{
		HttpOnly: true,
		MaxAge:   int(maxAge.Seconds()),
		Name:     service.config.AuthCookieName,
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
		Secure:   service.useSecureCookies(request),
		Value:    value,
	}
}

func (service *Service) oauthStateCookie(request *http.Request, value string, maxAge time.Duration) *http.Cookie {
	return &http.Cookie{
		HttpOnly: true,
		MaxAge:   int(maxAge.Seconds()),
		Name:     oauthStateCookieName,
		Path:     statePath,
		SameSite: http.SameSiteLaxMode,
		Secure:   service.useSecureCookies(request),
		Value:    value,
	}
}

func (service *Service) clearSessionCookie(response http.ResponseWriter, request *http.Request) {
	cookie := service.sessionCookie(request, "", -1)
	cookie.Expires = time.Unix(0, 0)
	http.SetCookie(response, cookie)
}

func (service *Service) clearOAuthStateCookie(response http.ResponseWriter, request *http.Request) {
	cookie := service.oauthStateCookie(request, "", -1)
	cookie.Expires = time.Unix(0, 0)
	http.SetCookie(response, cookie)
}

func (service *Service) useSecureCookies(request *http.Request) bool {
	return request.TLS != nil || strings.HasPrefix(service.publicBaseURL(request), "https://")
}

func randomToken(bytesCount int) (string, error) {
	bytes := make([]byte, bytesCount)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func getDiscordAvatarURL(user discordUserResponse) string {
	if user.Avatar == nil || *user.Avatar == "" {
		return ""
	}

	return "https://cdn.discordapp.com/avatars/" + user.ID + "/" + *user.Avatar + ".png"
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}
