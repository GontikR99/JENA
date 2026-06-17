package identityservice

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestStableIDForAuthTokenReturnsSessionUser(t *testing.T) {
	service := New(fakeSessionResolver{
		stableID: "discord:123",
	})
	authToken := "token"

	stableID, err := service.StableIDForAuthToken(context.Background(), &authToken)
	if err != nil {
		t.Fatalf("StableIDForAuthToken returned error: %v", err)
	}

	if stableID != "discord:123" {
		t.Fatalf("stableID %q, want discord:123", stableID)
	}
}

func TestStableIDForAuthTokenRejectsNilToken(t *testing.T) {
	service := New(fakeSessionResolver{})

	_, err := service.StableIDForAuthToken(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "auth token is required") {
		t.Fatalf("error %v, want required auth token error", err)
	}
}

func TestStableIDForAuthTokenRejectsEmptyToken(t *testing.T) {
	service := New(fakeSessionResolver{})
	authToken := " "

	_, err := service.StableIDForAuthToken(context.Background(), &authToken)
	if err == nil || !strings.Contains(err.Error(), "auth token is required") {
		t.Fatalf("error %v, want required auth token error", err)
	}
}

func TestStableIDForAuthTokenPropagatesResolverError(t *testing.T) {
	service := New(fakeSessionResolver{
		err: errors.New("auth token is invalid"),
	})
	authToken := "token"

	_, err := service.StableIDForAuthToken(context.Background(), &authToken)
	if err == nil || !strings.Contains(err.Error(), "auth token is invalid") {
		t.Fatalf("error %v, want resolver error", err)
	}
}

type fakeSessionResolver struct {
	err      error
	stableID string
}

func (resolver fakeSessionResolver) StableIDForSessionToken(_ context.Context, _ string) (string, error) {
	if resolver.err != nil {
		return "", resolver.err
	}

	return resolver.stableID, nil
}
