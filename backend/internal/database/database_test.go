package database

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"jena/backend/internal/config"
)

func TestNewCreatesDatabaseDirectoryConfiguresPoolAndAppliesPragmas(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "nested", "jena.db")

	database, err := New(config.Config{
		DatabaseMaxIdleConns: 16,
		DatabaseMaxOpenConns: 4,
		DatabasePath:         databasePath,
		DatabaseRetryCount:   5,
		DatabaseRetryDelayMs: 25,
	})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer database.Close()

	stats := database.SQL().Stats()
	if stats.MaxOpenConnections != 4 {
		t.Fatalf("MaxOpenConnections %d, want 4", stats.MaxOpenConnections)
	}

	var journalMode string
	if err := database.QueryRowContext(context.Background(), "PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatalf("query journal_mode: %v", err)
	}
	if journalMode != "wal" {
		t.Fatalf("journal_mode %q, want wal", journalMode)
	}

	var foreignKeys int
	if err := database.QueryRowContext(context.Background(), "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		t.Fatalf("query foreign_keys: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys %d, want 1", foreignKeys)
	}

	var busyTimeout int
	if err := database.QueryRowContext(context.Background(), "PRAGMA busy_timeout").Scan(&busyTimeout); err != nil {
		t.Fatalf("query busy_timeout: %v", err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("busy_timeout %d, want 5000", busyTimeout)
	}

	if _, err := database.ExecContext(context.Background(), "CREATE TABLE test (id INTEGER PRIMARY KEY)"); err != nil {
		t.Fatalf("ExecContext returned error: %v", err)
	}
}

func TestWithRetryRetriesLockedErrors(t *testing.T) {
	database := &Database{
		retryCount: 2,
		retryDelay: time.Nanosecond,
	}
	attempts := 0

	err := database.withRetry(context.Background(), func() error {
		attempts++

		if attempts < 3 {
			return errors.New("database is locked (SQLITE_BUSY)")
		}

		return nil
	})
	if err != nil {
		t.Fatalf("withRetry returned error: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("attempts %d, want 3", attempts)
	}
}

func TestWithRetryDoesNotRetryNonSQLiteLockErrors(t *testing.T) {
	database := &Database{
		retryCount: 2,
		retryDelay: time.Nanosecond,
	}
	attempts := 0
	expectedError := errors.New("syntax error")

	err := database.withRetry(context.Background(), func() error {
		attempts++
		return expectedError
	})

	if !errors.Is(err, expectedError) {
		t.Fatalf("withRetry error %v, want %v", err, expectedError)
	}
	if attempts != 1 {
		t.Fatalf("attempts %d, want 1", attempts)
	}
}
