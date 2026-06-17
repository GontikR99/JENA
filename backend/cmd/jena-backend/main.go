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
	"jena/backend/internal/identityservice"
	"jena/backend/internal/logging"
	"jena/backend/internal/triggerstore"
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
	app.Install(container, bus)

	server := httpserver.New(config, installedLogger)
	app.Install(container, server)

	authService, err := authservice.New(context.Background(), bus, db, config, installedLogger)
	if err != nil {
		return err
	}
	defer authService.Dispose()
	app.Install(container, authService)

	bridge := websocketbridge.New(bus, installedLogger, config.AuthCookieName)
	app.Install(container, bridge)

	worldwidePresenceService := worldwidepresenceservice.New(bus, installedLogger)
	app.Install(container, worldwidePresenceService)

	identityService := identityservice.New(authService)
	app.Install(container, identityService)

	triggerStore, err := triggerstore.New(context.Background(), bus, db)
	if err != nil {
		return err
	}
	defer triggerStore.Dispose()
	app.Install(container, triggerStore)

	userTriggerStore, err := usertriggerstore.New(context.Background(), bus, db, identityService, triggerStore)
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

	return server.Run(ctx)
}
