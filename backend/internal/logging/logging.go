package logging

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"jena/backend/internal/config"
)

type Level int

const (
	LevelTrace Level = iota
	LevelDebug
	LevelInfo
	LevelWarn
	LevelError
	LevelFatal
)

type Field struct {
	key   string
	value any
}

type Logger interface {
	Trace(ctx context.Context, message string, fields ...Field)
	Debug(ctx context.Context, message string, fields ...Field)
	Info(ctx context.Context, message string, fields ...Field)
	Warn(ctx context.Context, message string, fields ...Field)
	Error(ctx context.Context, message string, fields ...Field)
	Fatal(ctx context.Context, message string, fields ...Field)
	Close() error
}

type Service struct {
	exit  func(int)
	level Level
	now   func() time.Time
	sink  sink
}

type entry struct {
	fields    []Field
	level     Level
	message   string
	timestamp time.Time
}

type sink interface {
	Close() error
	Write(context.Context, entry) error
}

func New(config config.Config) (*Service, error) {
	level, err := ParseLevel(config.LogLevel)
	if err != nil {
		return nil, err
	}

	logSink, err := newSink(config)
	if err != nil {
		return nil, err
	}

	return &Service{
		exit:  os.Exit,
		level: level,
		now:   time.Now,
		sink:  logSink,
	}, nil
}

func NewNop() *Service {
	return &Service{
		exit:  func(int) {},
		level: LevelFatal,
		now:   time.Now,
		sink:  nopSink{},
	}
}

func ParseLevel(value string) (Level, error) {
	switch strings.ToLower(value) {
	case "trace":
		return LevelTrace, nil
	case "debug":
		return LevelDebug, nil
	case "info":
		return LevelInfo, nil
	case "warn", "warning":
		return LevelWarn, nil
	case "error":
		return LevelError, nil
	case "fatal":
		return LevelFatal, nil
	default:
		return LevelInfo, fmt.Errorf("unknown log level %q", value)
	}
}

func String(key string, value string) Field {
	return Field{key: key, value: value}
}

func Int(key string, value int) Field {
	return Field{key: key, value: value}
}

func Int64(key string, value int64) Field {
	return Field{key: key, value: value}
}

func Float64(key string, value float64) Field {
	return Field{key: key, value: value}
}

func Bool(key string, value bool) Field {
	return Field{key: key, value: value}
}

func Error(err error) Field {
	if err == nil {
		return String("error", "")
	}

	return String("error", err.Error())
}

func (logger *Service) Trace(ctx context.Context, message string, fields ...Field) {
	logger.log(ctx, LevelTrace, message, fields...)
}

func (logger *Service) Debug(ctx context.Context, message string, fields ...Field) {
	logger.log(ctx, LevelDebug, message, fields...)
}

func (logger *Service) Info(ctx context.Context, message string, fields ...Field) {
	logger.log(ctx, LevelInfo, message, fields...)
}

func (logger *Service) Warn(ctx context.Context, message string, fields ...Field) {
	logger.log(ctx, LevelWarn, message, fields...)
}

func (logger *Service) Error(ctx context.Context, message string, fields ...Field) {
	logger.log(ctx, LevelError, message, fields...)
}

func (logger *Service) Fatal(ctx context.Context, message string, fields ...Field) {
	logger.log(ctx, LevelFatal, message, fields...)
	_ = logger.Close()
	logger.exit(1)
}

func (logger *Service) Close() error {
	return logger.sink.Close()
}

func (logger *Service) log(ctx context.Context, level Level, message string, fields ...Field) {
	if level < logger.level {
		return
	}

	if err := logger.sink.Write(ctx, entry{
		fields:    normalizeFields(fields),
		level:     level,
		message:   message,
		timestamp: logger.now().UTC(),
	}); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "logging failure: %v\n", err)
	}
}

func newSink(config config.Config) (sink, error) {
	switch config.LogTarget {
	case "console":
		return newConsoleSink(os.Stderr), nil
	case "file":
		return newRotatingFileSink(config.LogFilePath, 1024*1024, 10)
	case "elasticsearch":
		return newElasticsearchSink(elasticsearchSinkOptions{
			indexPrefix: config.LogElasticsearchIndexPrefix,
			output:      os.Stderr,
			url:         config.LogElasticsearchURL,
		})
	default:
		return nil, fmt.Errorf("unknown log target %q", config.LogTarget)
	}
}

func normalizeFields(fields []Field) []Field {
	normalized := make([]Field, 0, len(fields))

	for _, field := range fields {
		if strings.TrimSpace(field.key) == "" {
			continue
		}

		normalized = append(normalized, field)
	}

	return normalized
}

func levelString(level Level) string {
	switch level {
	case LevelTrace:
		return "trace"
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	case LevelFatal:
		return "fatal"
	default:
		return "info"
	}
}

type nopSink struct{}

func (nopSink) Close() error {
	return nil
}

func (nopSink) Write(context.Context, entry) error {
	return nil
}

func setTestOutput(logger *Service, output io.Writer) {
	if console, ok := logger.sink.(*consoleSink); ok {
		console.output = output
	}
}
