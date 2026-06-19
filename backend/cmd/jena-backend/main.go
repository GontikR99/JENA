package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"jena/backend/internal/app"
	"jena/backend/internal/authservice"
	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/httpserver"
	"jena/backend/internal/logging"
	"jena/backend/internal/sharingservice"
	"jena/backend/internal/subscriptionservice"
	"jena/backend/internal/triggerstore"
	"jena/backend/internal/userbridge"
	"jena/backend/internal/usersettings"
	"jena/backend/internal/usertriggerstore"
	"jena/backend/internal/websocketbridge"
	"jena/backend/internal/worldwidepresenceservice"
)

func main() {
	if err := run(os.Args[1:]); err != nil && !errors.Is(err, context.Canceled) {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	config, err := config.Parse(args)
	if err != nil {
		return err
	}

	container := app.NewContainer()
	app.Install(container, config)

	logger, err := logging.New(config)
	if err != nil {
		return err
	}
	defer logger.Close()
	app.Install[logging.Logger](container, logger)

	installedLogger, err := app.Get[logging.Logger](container)
	if err != nil {
		return err
	}

	db, err := database.New(config)
	if err != nil {
		return err
	}
	defer db.Close()
	app.Install(container, db)

	bus := eventbus.New()
	bus.SetLogger(installedLogger)
	app.Install(container, bus)

	server := httpserver.New(config, installedLogger)
	app.Install(container, server)

	userSettingsStore, err := usersettings.NewStore(context.Background(), db)
	if err != nil {
		return err
	}
	app.Install(container, userSettingsStore)

	authService, err := authservice.New(context.Background(), bus, db, config, installedLogger, userSettingsStore)
	if err != nil {
		return err
	}
	defer authService.Dispose()
	app.Install(container, authService)

	userSettingsService := usersettings.NewService(bus, authService, userSettingsStore)
	defer userSettingsService.Dispose()
	app.Install(container, userSettingsService)

	bridge := websocketbridge.New(bus, installedLogger, config.AuthCookieName, authService)
	app.Install(container, bridge)

	userBridge := userbridge.New(bus)
	defer userBridge.Dispose()
	app.Install(container, userBridge)

	worldwidePresenceService := worldwidepresenceservice.New(bus, installedLogger)
	app.Install(container, worldwidePresenceService)

	triggerStore, err := triggerstore.New(context.Background(), bus, db, installedLogger)
	if err != nil {
		return err
	}
	defer triggerStore.Dispose()
	app.Install(container, triggerStore)

	sharingService, err := sharingservice.New(context.Background(), bus, db, authService, triggerStore, userSettingsStore, config)
	if err != nil {
		return err
	}
	defer sharingService.Dispose()
	app.Install(container, sharingService)

	subscriptionService, err := subscriptionservice.New(context.Background(), bus, db, authService, userSettingsStore, config, installedLogger)
	if err != nil {
		return err
	}
	defer subscriptionService.Dispose()
	app.Install(container, subscriptionService)

	userTriggerStore, err := usertriggerstore.New(context.Background(), bus, db, authService, triggerStore, installedLogger)
	if err != nil {
		return err
	}
	defer userTriggerStore.Dispose()
	app.Install(container, userTriggerStore)

	server.RegisterFunc("GET /_jena/health", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})
	server.RegisterFunc("GET "+authService.LoginPath(), authService.ServeLogin)
	server.RegisterFunc("GET "+authService.CallbackPath(), authService.ServeCallback)
	server.RegisterFunc("POST "+authService.LogoutPath(), authService.ServeLogout)
	server.Register(config.WebSocketPath, bridge)
	server.RegisterStaticApp()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	defer bridge.StopActiveConnectionLogging()

	installedLogger.Info(
		ctx,
		"backend configured",
		logging.String("addr", config.Addr),
		logging.String("databasePath", config.DatabasePath),
		logging.String("websocketPath", config.WebSocketPath),
	)

	go bridge.StartActiveConnectionLogging(ctx)
	go sharingService.StartCleanup(ctx)
	go subscriptionService.StartCleanup(ctx)

	return server.Run(ctx)
}
