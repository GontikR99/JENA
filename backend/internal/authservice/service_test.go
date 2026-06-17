package authservice

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/logging"
)

func TestServeLoginBuildsDiscordRedirectFromRequestHost(t *testing.T) {
	service := newTestService(t)
	request := httptest.NewRequest(http.MethodGet, "http://localhost:5173"+loginPath, nil)
	response := httptest.NewRecorder()

	service.ServeLogin(response, request)

	if response.Code != http.StatusFound {
		t.Fatalf("status %d, want %d", response.Code, http.StatusFound)
	}

	location := response.Header().Get("Location")
	parsedLocation, err := url.Parse(location)
	if err != nil {
		t.Fatalf("Parse Location returned error: %v", err)
	}

	if parsedLocation.Scheme != "https" || parsedLocation.Host != "discord.com" || parsedLocation.Path != "/oauth2/authorize" {
		t.Fatalf("Location %q, want Discord authorize URL", location)
	}
	if parsedLocation.Query().Get("redirect_uri") != "http://localhost:5173"+callbackPath {
		t.Fatalf("redirect_uri %q, want localhost callback", parsedLocation.Query().Get("redirect_uri"))
	}
	if parsedLocation.Query().Get("scope") != discordScope {
		t.Fatalf("scope %q, want %q", parsedLocation.Query().Get("scope"), discordScope)
	}
	if parsedLocation.Query().Get("state") == "" {
		t.Fatal("state query parameter is required")
	}

	foundStateCookie := false
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == oauthStateCookieName && cookie.Value != "" {
			foundStateCookie = true
		}
	}
	if !foundStateCookie {
		t.Fatal("OAuth state cookie was not set")
	}
}

func TestStableIDForSessionTokenReturnsStoredDiscordUser(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	user, err := service.upsertDiscordUser(ctx, discordUserResponse{
		ID:       "123456789",
		Username: "mesozoic",
	})
	if err != nil {
		t.Fatalf("upsertDiscordUser returned error: %v", err)
	}

	token, err := service.createSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("createSession returned error: %v", err)
	}

	stableID, err := service.StableIDForSessionToken(ctx, token)
	if err != nil {
		t.Fatalf("StableIDForSessionToken returned error: %v", err)
	}
	if stableID != "discord:123456789" {
		t.Fatalf("stableID %q, want discord:123456789", stableID)
	}
}

func TestStableIDForSessionTokenRejectsInvalidToken(t *testing.T) {
	service := newTestService(t)

	_, err := service.StableIDForSessionToken(context.Background(), "invalid")
	if err == nil || !strings.Contains(err.Error(), "auth token is invalid") {
		t.Fatalf("error %v, want invalid token error", err)
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()

	cfg := config.Config{
		AuthCookieName:       "jena_session",
		AuthSessionDays:      365,
		DatabaseMaxIdleConns: 1,
		DatabaseMaxOpenConns: 1,
		DatabasePath:         t.TempDir() + "/jena.db",
		DatabaseRetryCount:   0,
		DatabaseRetryDelayMs: 0,
		DiscordClientID:      "discord-client-id",
		DiscordClientSecret:  "discord-client-secret",
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

	service, err := New(context.Background(), eventbus.New(), db, cfg, logging.NewNop())
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(service.Dispose)

	return service
}
