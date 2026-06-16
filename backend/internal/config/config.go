package config

import (
	"flag"
	"fmt"
	"io"
)

type Config struct {
	Addr                 string
	DatabaseMaxIdleConns int
	DatabaseMaxOpenConns int
	DatabasePath         string
	DatabaseRetryCount   int
	DatabaseRetryDelayMs int
	WebSocketPath        string
}

func Parse(args []string) (Config, error) {
	return parse(args, flag.CommandLine.Output())
}

func ParseForTest(args []string) (Config, error) {
	return parse(args, io.Discard)
}

func parse(args []string, output io.Writer) (Config, error) {
	config := Config{}
	flags := flag.NewFlagSet("jena-backend", flag.ContinueOnError)
	flags.SetOutput(output)

	flags.StringVar(&config.Addr, "addr", "127.0.0.1:8080", "HTTP listen address")
	flags.IntVar(&config.DatabaseMaxIdleConns, "database-max-idle-conns", 8, "maximum idle SQLite connections")
	flags.IntVar(&config.DatabaseMaxOpenConns, "database-max-open-conns", 8, "maximum open SQLite connections")
	flags.StringVar(&config.DatabasePath, "database-path", "jena.db", "SQLite database file path")
	flags.IntVar(&config.DatabaseRetryCount, "database-retry-count", 5, "SQLite busy/locked retry attempts")
	flags.IntVar(&config.DatabaseRetryDelayMs, "database-retry-delay-ms", 25, "initial SQLite busy/locked retry delay in milliseconds")
	flags.StringVar(&config.WebSocketPath, "websocket-path", "/_jena/ws", "event bus websocket endpoint path")

	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}

	if config.WebSocketPath == "" || config.WebSocketPath[0] != '/' {
		return Config{}, fmt.Errorf("websocket-path must start with /")
	}
	if config.DatabasePath == "" {
		return Config{}, fmt.Errorf("database-path must not be empty")
	}
	if config.DatabaseMaxOpenConns < 1 {
		return Config{}, fmt.Errorf("database-max-open-conns must be at least 1")
	}
	if config.DatabaseMaxIdleConns < 0 {
		return Config{}, fmt.Errorf("database-max-idle-conns must not be negative")
	}
	if config.DatabaseRetryCount < 0 {
		return Config{}, fmt.Errorf("database-retry-count must not be negative")
	}
	if config.DatabaseRetryDelayMs < 0 {
		return Config{}, fmt.Errorf("database-retry-delay-ms must not be negative")
	}

	return config, nil
}
