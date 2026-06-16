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

func TestParseRejectsInvalidDatabasePoolSettings(t *testing.T) {
	cases := [][]string{
		{"-database-max-open-conns", "0"},
		{"-database-max-idle-conns", "-1"},
		{"-database-retry-count", "-1"},
		{"-database-retry-delay-ms", "-1"},
	}

	for _, args := range cases {
		_, err := ParseForTest(args)
		if err == nil {
			t.Fatalf("ParseForTest(%v) expected error", args)
		}
	}
}
