package logging

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMarshalJSONLineUsesStructuredFields(t *testing.T) {
	line, err := marshalJSONLine(entry{
		fields: []Field{
			String("component", "test"),
			Int("count", 3),
			Bool("active", true),
		},
		level:     LevelInfo,
		message:   "test message",
		timestamp: time.Date(2026, 6, 16, 12, 30, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("marshalJSONLine returned error: %v", err)
	}

	var record map[string]any
	if err := json.Unmarshal(line, &record); err != nil {
		t.Fatalf("Unmarshal returned error: %v", err)
	}

	if record["@timestamp"] != "2026-06-16T12:30:00Z" {
		t.Fatalf("timestamp %v, want 2026-06-16T12:30:00Z", record["@timestamp"])
	}
	if record["level"] != "info" {
		t.Fatalf("level %v, want info", record["level"])
	}
	if record["message"] != "test message" {
		t.Fatalf("message %v, want test message", record["message"])
	}
	if record["component"] != "test" {
		t.Fatalf("component %v, want test", record["component"])
	}
	if record["count"] != float64(3) {
		t.Fatalf("count %v, want 3", record["count"])
	}
	if record["active"] != true {
		t.Fatalf("active %v, want true", record["active"])
	}
}

func TestRotatingFileSinkRotatesAndRetainsConfiguredRolls(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jena.log")
	sink, err := newRotatingFileSink(path, 160, 2)
	if err != nil {
		t.Fatalf("newRotatingFileSink returned error: %v", err)
	}
	defer sink.Close()

	for index := 0; index < 8; index++ {
		err := sink.Write(context.Background(), entry{
			fields: []Field{
				String("value", strings.Repeat("x", 40)),
			},
			level:     LevelInfo,
			message:   "rotation test",
			timestamp: time.Date(2026, 6, 16, 12, index, 0, 0, time.UTC),
		})
		if err != nil {
			t.Fatalf("Write returned error: %v", err)
		}
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("current log stat returned error: %v", err)
	}
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("first roll stat returned error: %v", err)
	}
	if _, err := os.Stat(path + ".2"); err != nil {
		t.Fatalf("second roll stat returned error: %v", err)
	}
	if _, err := os.Stat(path + ".3"); !os.IsNotExist(err) {
		t.Fatalf("third roll exists or stat returned unexpected error: %v", err)
	}
}

func TestElasticsearchSinkUsesDailyLowercaseIndexNames(t *testing.T) {
	sink := &elasticsearchSink{
		indexPrefix: "JENA-",
	}

	name := sink.indexName(time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC))

	if name != "jena-2026.06.16" {
		t.Fatalf("index name %q, want jena-2026.06.16", name)
	}
}

func TestElasticsearchBulkPayload(t *testing.T) {
	sink := &elasticsearchSink{
		indexPrefix: "JENA-",
	}

	payload, err := sink.bulkPayload([]entry{
		{
			fields: []Field{
				String("component", "bulk-test"),
			},
			level:     LevelWarn,
			message:   "bulk test",
			timestamp: time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC),
		},
	})
	if err != nil {
		t.Fatalf("bulkPayload returned error: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(payload)), "\n")
	if len(lines) != 2 {
		t.Fatalf("line count %d, want 2", len(lines))
	}
	if !strings.Contains(lines[0], `"jena-2026.06.16"`) {
		t.Fatalf("action line %q does not contain index", lines[0])
	}
	if !strings.Contains(lines[1], `"message":"bulk test"`) {
		t.Fatalf("document line %q does not contain message", lines[1])
	}
	if !strings.Contains(lines[1], `"component":"bulk-test"`) {
		t.Fatalf("document line %q does not contain component", lines[1])
	}
}
