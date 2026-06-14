package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"jena/backend/internal/config"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

type Database struct {
	db         *sql.DB
	retryCount int
	retryDelay time.Duration
}

type Row struct {
	args     []any
	ctx      context.Context
	database *Database
	query    string
}

func New(config config.Config) (*Database, error) {
	if err := ensureDatabaseDirectory(config.DatabasePath); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", getDataSourceName(config.DatabasePath))
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	db.SetMaxOpenConns(config.DatabaseMaxOpenConns)
	db.SetMaxIdleConns(getMaxIdleConns(config))

	if err := configure(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &Database{
		db:         db,
		retryCount: config.DatabaseRetryCount,
		retryDelay: time.Duration(config.DatabaseRetryDelayMs) * time.Millisecond,
	}, nil
}

func (database *Database) SQL() *sql.DB {
	return database.db
}

func (database *Database) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	var result sql.Result

	err := database.withRetry(ctx, func() error {
		var err error
		result, err = database.db.ExecContext(ctx, query, args...)
		return err
	})

	return result, err
}

func (database *Database) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	var rows *sql.Rows

	err := database.withRetry(ctx, func() error {
		var err error
		rows, err = database.db.QueryContext(ctx, query, args...)
		return err
	})

	return rows, err
}

func (database *Database) QueryRowContext(ctx context.Context, query string, args ...any) *Row {
	return &Row{
		args:     args,
		ctx:      ctx,
		database: database,
		query:    query,
	}
}

func (row *Row) Scan(dest ...any) error {
	return row.database.withRetry(row.ctx, func() error {
		return row.database.db.QueryRowContext(row.ctx, row.query, row.args...).Scan(dest...)
	})
}

func (database *Database) Close() error {
	return database.db.Close()
}

func configure(db *sql.DB) error {
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
	}

	for _, pragma := range pragmas {
		if _, err := db.Exec(pragma); err != nil {
			return fmt.Errorf("apply %s: %w", pragma, err)
		}
	}

	return nil
}

func (database *Database) withRetry(ctx context.Context, run func() error) error {
	var err error

	for attempt := 0; attempt <= database.retryCount; attempt++ {
		err = run()
		if err == nil || !isRetryableSQLiteError(err) {
			return err
		}

		if attempt == database.retryCount {
			break
		}

		delay := database.retryDelay * time.Duration(1<<attempt)
		if delay <= 0 {
			continue
		}

		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}

	return err
}

func ensureDatabaseDirectory(databasePath string) error {
	if databasePath == ":memory:" {
		return nil
	}

	directory := filepath.Dir(databasePath)
	if directory == "." || directory == "" {
		return nil
	}

	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create database directory: %w", err)
	}

	return nil
}

func getDataSourceName(databasePath string) string {
	values := url.Values{}
	values.Add("_pragma", "busy_timeout(5000)")
	values.Add("_pragma", "foreign_keys(1)")
	values.Add("_pragma", "journal_mode(WAL)")

	separator := "?"
	if strings.Contains(databasePath, "?") {
		separator = "&"
	}

	return databasePath + separator + values.Encode()
}

func getMaxIdleConns(config config.Config) int {
	if config.DatabaseMaxIdleConns > config.DatabaseMaxOpenConns {
		return config.DatabaseMaxOpenConns
	}

	return config.DatabaseMaxIdleConns
}

func isRetryableSQLiteError(err error) bool {
	var sqliteError *sqlite.Error
	if errors.As(err, &sqliteError) {
		code := sqliteError.Code() & 0xff
		return code == sqlite3.SQLITE_BUSY || code == sqlite3.SQLITE_LOCKED
	}

	errorMessage := err.Error()

	return strings.Contains(errorMessage, "SQLITE_BUSY") ||
		strings.Contains(errorMessage, "SQLITE_LOCKED") ||
		strings.Contains(errorMessage, "database is locked") ||
		strings.Contains(errorMessage, "database table is locked")
}
