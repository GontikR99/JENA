package logging

import (
	"encoding/json"
	"time"
)

func marshalJSONLine(logEntry entry) ([]byte, error) {
	record, err := entryRecord(logEntry)
	if err != nil {
		return nil, err
	}

	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}

	return append(encoded, '\n'), nil
}

func entryRecord(logEntry entry) (map[string]any, error) {
	record := map[string]any{
		"@timestamp": formatTimestamp(logEntry.timestamp),
		"level":      levelString(logEntry.level),
		"message":    logEntry.message,
		"service":    "jena-backend",
	}

	for _, field := range logEntry.fields {
		value, err := fieldValue(field.value)
		if err != nil {
			return nil, err
		}

		record[field.key] = value
	}

	return record, nil
}

func fieldValue(value any) (any, error) {
	switch typedValue := value.(type) {
	case nil:
		return nil, nil
	case bool:
		return typedValue, nil
	case float64:
		return typedValue, nil
	case int:
		return typedValue, nil
	case int64:
		return typedValue, nil
	case string:
		return typedValue, nil
	default:
		encoded, err := json.Marshal(typedValue)
		if err != nil {
			return nil, err
		}

		var decoded any
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			return nil, err
		}

		return decoded, nil
	}
}

func formatTimestamp(timestamp time.Time) string {
	return timestamp.UTC().Format(time.RFC3339Nano)
}
