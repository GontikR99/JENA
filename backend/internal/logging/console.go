package logging

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"sync"
)

type consoleSink struct {
	mu     sync.Mutex
	output io.Writer
}

func newConsoleSink(output io.Writer) *consoleSink {
	return &consoleSink{
		output: output,
	}
}

func (sink *consoleSink) Close() error {
	return nil
}

func (sink *consoleSink) Write(_ context.Context, logEntry entry) error {
	sink.mu.Lock()
	defer sink.mu.Unlock()

	_, err := fmt.Fprintf(
		sink.output,
		"time=%s level=%s message=%s",
		formatTimestamp(logEntry.timestamp),
		levelString(logEntry.level),
		strconv.Quote(logEntry.message),
	)
	if err != nil {
		return err
	}

	for _, field := range logEntry.fields {
		if _, err := fmt.Fprintf(
			sink.output,
			" %s=%s",
			field.key,
			formatConsoleValue(field.value),
		); err != nil {
			return err
		}
	}

	_, err = fmt.Fprintln(sink.output)
	return err
}

func formatConsoleValue(value any) string {
	switch typedValue := value.(type) {
	case bool:
		return strconv.FormatBool(typedValue)
	case float64:
		return strconv.FormatFloat(typedValue, 'f', -1, 64)
	case int:
		return strconv.Itoa(typedValue)
	case int64:
		return strconv.FormatInt(typedValue, 10)
	case string:
		return strconv.Quote(typedValue)
	default:
		return strconv.Quote(fmt.Sprint(typedValue))
	}
}
