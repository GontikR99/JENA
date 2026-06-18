package config

import (
	"flag"
	"fmt"
	"io"
	"slices"
)

type Config struct {
	Addr                        string
	AuthCookieName              string
	AuthPublicBaseURL           string
	AuthSessionDays             int
	DatabaseMaxIdleConns        int
	DatabaseMaxOpenConns        int
	DatabasePath                string
	DatabaseRetryCount          int
	DatabaseRetryDelayMs        int
	DiscordClientID             string
	DiscordClientSecret         string
	LogElasticsearchIndexPrefix string
	LogElasticsearchURL         string
	LogFilePath                 string
	LogLevel                    string
	LogTarget                   string
	SharePackageCleanupMinutes  int
	SharePackageTTLMins         int
	WebSocketPath               string
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
	flags.StringVar(&config.AuthCookieName, "auth-cookie-name", "jena_session", "authentication session cookie name")
	flags.StringVar(&config.AuthPublicBaseURL, "auth-public-base-url", "", "public base URL for OAuth redirects; defaults to the incoming request scheme and host")
	flags.IntVar(&config.AuthSessionDays, "auth-session-days", 365, "authentication session duration in days")
	flags.IntVar(&config.DatabaseMaxIdleConns, "database-max-idle-conns", 8, "maximum idle SQLite connections")
	flags.IntVar(&config.DatabaseMaxOpenConns, "database-max-open-conns", 8, "maximum open SQLite connections")
	flags.StringVar(&config.DatabasePath, "database-path", "jena.db", "SQLite database file path")
	flags.IntVar(&config.DatabaseRetryCount, "database-retry-count", 5, "SQLite busy/locked retry attempts")
	flags.IntVar(&config.DatabaseRetryDelayMs, "database-retry-delay-ms", 25, "initial SQLite busy/locked retry delay in milliseconds")
	flags.StringVar(&config.DiscordClientID, "discord-client-id", "", "Discord OAuth2 client ID")
	flags.StringVar(&config.DiscordClientSecret, "discord-client-secret", "", "Discord OAuth2 client secret")
	flags.StringVar(&config.LogElasticsearchIndexPrefix, "log-elasticsearch-index-prefix", "JENA-", "Elasticsearch daily index prefix")
	flags.StringVar(&config.LogElasticsearchURL, "log-elasticsearch-url", "", "Elasticsearch base URL for log delivery")
	flags.StringVar(&config.LogFilePath, "log-file-path", "jena.log", "log file path when -log-target=file")
	flags.StringVar(&config.LogLevel, "log-level", "info", "minimum log level: trace, debug, info, warn, error, fatal")
	flags.StringVar(&config.LogTarget, "log-target", "console", "log output target: console, file, elasticsearch")
	flags.IntVar(&config.SharePackageCleanupMinutes, "share-package-cleanup-minutes", 5, "share package cleanup interval in minutes")
	flags.IntVar(&config.SharePackageTTLMins, "share-package-ttl-minutes", 240, "share package duration in minutes")
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
	if config.AuthCookieName == "" {
		return Config{}, fmt.Errorf("auth-cookie-name must not be empty")
	}
	if config.AuthSessionDays < 1 {
		return Config{}, fmt.Errorf("auth-session-days must be at least 1")
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
	if config.SharePackageCleanupMinutes < 1 {
		return Config{}, fmt.Errorf("share-package-cleanup-minutes must be at least 1")
	}
	if config.SharePackageTTLMins < 1 {
		return Config{}, fmt.Errorf("share-package-ttl-minutes must be at least 1")
	}
	if !slices.Contains([]string{"trace", "debug", "info", "warn", "warning", "error", "fatal"}, config.LogLevel) {
		return Config{}, fmt.Errorf("log-level must be one of trace, debug, info, warn, error, fatal")
	}
	if !slices.Contains([]string{"console", "file", "elasticsearch"}, config.LogTarget) {
		return Config{}, fmt.Errorf("log-target must be one of console, file, elasticsearch")
	}
	if config.LogTarget == "file" && config.LogFilePath == "" {
		return Config{}, fmt.Errorf("log-file-path must not be empty when log-target=file")
	}
	if config.LogTarget == "elasticsearch" && config.LogElasticsearchURL == "" {
		return Config{}, fmt.Errorf("log-elasticsearch-url must not be empty when log-target=elasticsearch")
	}
	if config.LogTarget == "elasticsearch" && config.LogElasticsearchIndexPrefix == "" {
		return Config{}, fmt.Errorf("log-elasticsearch-index-prefix must not be empty when log-target=elasticsearch")
	}

	return config, nil
}
