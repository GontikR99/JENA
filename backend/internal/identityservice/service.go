package identityservice

import (
	"context"
	"errors"
	"strings"
)

type Service struct{}

func New() *Service {
	return &Service{}
}

func (service *Service) StableIDForAuthToken(_ context.Context, authToken *string) (string, error) {
	if authToken == nil || strings.TrimSpace(*authToken) == "" {
		return "", errors.New("auth token is required")
	}

	return "test-user", nil
}
