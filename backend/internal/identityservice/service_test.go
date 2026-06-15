package identityservice

import (
	"context"
	"strings"
	"testing"
)

func TestStableIDForAuthTokenReturnsDummyUser(t *testing.T) {
	service := New()
	authToken := "token"

	stableID, err := service.StableIDForAuthToken(context.Background(), &authToken)
	if err != nil {
		t.Fatalf("StableIDForAuthToken returned error: %v", err)
	}

	if stableID != "test-user" {
		t.Fatalf("stableID %q, want test-user", stableID)
	}
}

func TestStableIDForAuthTokenRejectsNilToken(t *testing.T) {
	service := New()

	_, err := service.StableIDForAuthToken(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "auth token is required") {
		t.Fatalf("error %v, want required auth token error", err)
	}
}

func TestStableIDForAuthTokenRejectsEmptyToken(t *testing.T) {
	service := New()
	authToken := " "

	_, err := service.StableIDForAuthToken(context.Background(), &authToken)
	if err == nil || !strings.Contains(err.Error(), "auth token is required") {
		t.Fatalf("error %v, want required auth token error", err)
	}
}
