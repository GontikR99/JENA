package userbridge

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"jena/backend/internal/eventbus"
	"jena/backend/internal/websocketbridge"
)

const userEndpointPrefix = "user."

type Service struct {
	mu            sync.Mutex
	sourcesByUser map[string]map[string]struct{}
	sourceUser    map[string]string
	unregister    func()
}

func New(bus *eventbus.Bus) *Service {
	service := &Service{
		sourcesByUser: make(map[string]map[string]struct{}),
		sourceUser:    make(map[string]string),
	}

	unlistenConnected := bus.Listen(websocketbridge.UserConnectedEndpoint, service.handleUserConnected)
	unlistenDisconnected := bus.Listen(websocketbridge.UserDisconnectedEndpoint, service.handleUserDisconnected)
	unlistenUserMessages := bus.Listen("user.*", service.handleUserMessage(bus))
	service.unregister = func() {
		unlistenConnected()
		unlistenDisconnected()
		unlistenUserMessages()
	}

	return service
}

func (service *Service) Dispose() {
	if service.unregister != nil {
		service.unregister()
		service.unregister = nil
	}
}

func (service *Service) handleUserConnected(_ context.Context, envelope eventbus.Envelope) {
	var event websocketbridge.UserConnectionEvent
	if err := json.Unmarshal(envelope.Payload, &event); err != nil {
		return
	}

	service.rememberSource(event.StableUserID, event.Source)
}

func (service *Service) handleUserDisconnected(_ context.Context, envelope eventbus.Envelope) {
	var event websocketbridge.UserConnectionEvent
	if err := json.Unmarshal(envelope.Payload, &event); err != nil {
		return
	}

	service.forgetSource(event.StableUserID, event.Source)
}

func (service *Service) handleUserMessage(bus *eventbus.Bus) eventbus.Listener {
	return func(ctx context.Context, envelope eventbus.Envelope) {
		userID, destination, ok := parseUserDestination(envelope.Destination)
		if !ok {
			return
		}

		for _, source := range service.activeSources(userID) {
			outbound := envelope
			outbound.Destination = source + "." + destination
			_ = bus.Send(ctx, outbound)
		}
	}
}

func (service *Service) rememberSource(userID string, source string) {
	userID = strings.TrimSpace(userID)
	if userID == "" || source == "" {
		return
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	if oldUserID, ok := service.sourceUser[source]; ok && oldUserID != userID {
		delete(service.sourcesByUser[oldUserID], source)
	}

	if service.sourcesByUser[userID] == nil {
		service.sourcesByUser[userID] = make(map[string]struct{})
	}

	service.sourcesByUser[userID][source] = struct{}{}
	service.sourceUser[source] = userID
}

func (service *Service) forgetSource(userID string, source string) {
	userID = strings.TrimSpace(userID)
	if userID == "" || source == "" {
		return
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	delete(service.sourceUser, source)
	delete(service.sourcesByUser[userID], source)
}

func (service *Service) activeSources(userID string) []string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return []string{}
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	sources := make([]string, 0, len(service.sourcesByUser[userID]))
	for source := range service.sourcesByUser[userID] {
		sources = append(sources, source)
	}

	return sources
}

func parseUserDestination(destination string) (string, string, bool) {
	if !strings.HasPrefix(destination, userEndpointPrefix) {
		return "", "", false
	}

	rest := strings.TrimPrefix(destination, userEndpointPrefix)
	userID, forwardedDestination, ok := strings.Cut(rest, ".")
	userID = strings.TrimSpace(userID)
	if !ok || userID == "" || forwardedDestination == "" {
		return "", "", false
	}

	return userID, forwardedDestination, true
}
