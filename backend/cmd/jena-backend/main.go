package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"jena/backend/internal/app"
	"jena/backend/internal/config"
	"jena/backend/internal/database"
	"jena/backend/internal/eventbus"
	"jena/backend/internal/httpserver"
	"jena/backend/internal/websocketbridge"
	"jena/backend/internal/worldwidepresenceservice"
)

func main() {
	if err := run(os.Args[1:]); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

func run(args []string) error {
	config, err := config.Parse(args)
	if err != nil {
		return err
	}

	container := app.NewContainer()
	app.Install(container, config)

	db, err := database.New(config)
	if err != nil {
		return err
	}
	defer db.Close()
	app.Install(container, db)

	bus := eventbus.New()
	app.Install(container, bus)

	server := httpserver.New(config)
	app.Install(container, server)

	bridge := websocketbridge.New(bus)
	app.Install(container, bridge)

	worldwidePresenceService := worldwidepresenceservice.New(bus)
	app.Install(container, worldwidePresenceService)

	server.RegisterFunc("GET /_jena/health", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})
	server.Register(config.WebSocketPath, bridge)
	server.RegisterStaticApp()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	slog.Info(
		"backend configured",
		"addr", config.Addr,
		"databasePath", config.DatabasePath,
		"staticDir", config.StaticDir,
		"websocketPath", config.WebSocketPath,
	)

	return server.Run(ctx)
}
