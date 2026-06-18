package config

import "testing"

func TestParseDefaults(t *testing.T) {
	config, err := ParseForTest(nil)
	if err != nil {
		t.Fatalf("ParseForTest returned error: %v", err)
	}

	if config.Addr != "127.0.0.1:8080" {
		t.Fatalf("unexpected Addr %q", config.Addr)
	}
	if config.AuthCookieName != "jena_session" {
		t.Fatalf("unexpected AuthCookieName %q", config.AuthCookieName)
	}
	if config.AuthPublicBaseURL != "" {
		t.Fatalf("unexpected AuthPublicBaseURL %q", config.AuthPublicBaseURL)
	}
	if config.AuthSessionDays != 365 {
		t.Fatalf("unexpected AuthSessionDays %d", config.AuthSessionDays)
	}
	if config.DatabaseMaxIdleConns != 8 {
		t.Fatalf("unexpected DatabaseMaxIdleConns %d", config.DatabaseMaxIdleConns)
	}
	if config.DatabaseMaxOpenConns != 8 {
		t.Fatalf("unexpected DatabaseMaxOpenConns %d", config.DatabaseMaxOpenConns)
	}
	if config.DatabasePath != "jena.db" {
		t.Fatalf("unexpected DatabasePath %q", config.DatabasePath)
	}
	if config.DatabaseRetryCount != 5 {
		t.Fatalf("unexpected DatabaseRetryCount %d", config.DatabaseRetryCount)
	}
	if config.DatabaseRetryDelayMs != 25 {
		t.Fatalf("unexpected DatabaseRetryDelayMs %d", config.DatabaseRetryDelayMs)
	}
	if config.DiscordClientID != "" {
		t.Fatalf("unexpected DiscordClientID %q", config.DiscordClientID)
	}
	if config.DiscordClientSecret != "" {
		t.Fatalf("unexpected DiscordClientSecret %q", config.DiscordClientSecret)
	}
	if config.LogElasticsearchIndexPrefix != "JENA-" {
		t.Fatalf("unexpected LogElasticsearchIndexPrefix %q", config.LogElasticsearchIndexPrefix)
	}
	if config.LogElasticsearchURL != "" {
		t.Fatalf("unexpected LogElasticsearchURL %q", config.LogElasticsearchURL)
	}
	if config.LogFilePath != "jena.log" {
		t.Fatalf("unexpected LogFilePath %q", config.LogFilePath)
	}
	if config.LogLevel != "info" {
		t.Fatalf("unexpected LogLevel %q", config.LogLevel)
	}
	if config.LogTarget != "console" {
		t.Fatalf("unexpected LogTarget %q", config.LogTarget)
	}
	if config.SharePackageCleanupMinutes != 5 {
		t.Fatalf("unexpected SharePackageCleanupMinutes %d", config.SharePackageCleanupMinutes)
	}
	if config.SharePackageTTLMins != 240 {
		t.Fatalf("unexpected SharePackageTTLMins %d", config.SharePackageTTLMins)
	}
	if config.WebSocketPath != "/_jena/ws" {
		t.Fatalf("unexpected WebSocketPath %q", config.WebSocketPath)
	}
}

func TestParseRejectsRelativeWebSocketPath(t *testing.T) {
	_, err := ParseForTest([]string{"-websocket-path", "ws"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseRejectsEmptyDatabasePath(t *testing.T) {
	_, err := ParseForTest([]string{"-database-path", ""})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseRejectsInvalidLoggingSettings(t *testing.T) {
	cases := [][]string{
		{"-log-level", "loud"},
		{"-log-target", "printer"},
		{"-log-target", "file", "-log-file-path", ""},
		{"-log-target", "elasticsearch"},
		{"-log-target", "elasticsearch", "-log-elasticsearch-url", "http://localhost:9200", "-log-elasticsearch-index-prefix", ""},
	}

	for _, args := range cases {
		_, err := ParseForTest(args)
		if err == nil {
			t.Fatalf("ParseForTest(%v) expected error", args)
		}
	}
}

func TestParseRejectsInvalidDatabasePoolSettings(t *testing.T) {
	cases := [][]string{
		{"-database-max-open-conns", "0"},
		{"-database-max-idle-conns", "-1"},
		{"-database-retry-count", "-1"},
		{"-database-retry-delay-ms", "-1"},
		{"-auth-cookie-name", ""},
		{"-auth-session-days", "0"},
		{"-share-package-cleanup-minutes", "0"},
		{"-share-package-ttl-minutes", "0"},
	}

	for _, args := range cases {
		_, err := ParseForTest(args)
		if err == nil {
			t.Fatalf("ParseForTest(%v) expected error", args)
		}
	}
}
