package identityservice

import (
	"context"
	"errors"
	"strings"
)

type SessionResolver interface {
	StableIDForSessionToken(context.Context, string) (string, error)
}

type Service struct {
	sessions SessionResolver
}

func New(sessions SessionResolver) *Service {
	return &Service{
		sessions: sessions,
	}
}

func (service *Service) StableIDForAuthToken(ctx context.Context, authToken *string) (string, error) {
	if authToken == nil || strings.TrimSpace(*authToken) == "" {
		return "", errors.New("auth token is required")
	}
	if service.sessions == nil {
		return "", errors.New("auth session resolver is not configured")
	}

	return service.sessions.StableIDForSessionToken(ctx, *authToken)
}
