package logging

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type rotatingFileSink struct {
	file     *os.File
	maxBytes int64
	maxRolls int
	mu       sync.Mutex
	path     string
	size     int64
}

func newRotatingFileSink(path string, maxBytes int64, maxRolls int) (*rotatingFileSink, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("stat log file: %w", err)
	}

	return &rotatingFileSink{
		file:     file,
		maxBytes: maxBytes,
		maxRolls: maxRolls,
		path:     path,
		size:     info.Size(),
	}, nil
}

func (sink *rotatingFileSink) Close() error {
	sink.mu.Lock()
	defer sink.mu.Unlock()

	if sink.file == nil {
		return nil
	}

	err := sink.file.Close()
	sink.file = nil
	return err
}

func (sink *rotatingFileSink) Write(_ context.Context, logEntry entry) error {
	line, err := marshalJSONLine(logEntry)
	if err != nil {
		return err
	}

	sink.mu.Lock()
	defer sink.mu.Unlock()

	if sink.file == nil {
		return fmt.Errorf("log file is closed")
	}

	if sink.size > 0 && sink.size+int64(len(line)) > sink.maxBytes {
		if err := sink.rotate(); err != nil {
			return err
		}
	}

	n, err := sink.file.Write(line)
	sink.size += int64(n)
	return err
}

func (sink *rotatingFileSink) rotate() error {
	if err := sink.file.Close(); err != nil {
		return err
	}

	_ = os.Remove(sink.rollPath(sink.maxRolls))
	for index := sink.maxRolls - 1; index >= 1; index-- {
		oldPath := sink.rollPath(index)
		newPath := sink.rollPath(index + 1)

		if _, err := os.Stat(oldPath); err == nil {
			if err := os.Rename(oldPath, newPath); err != nil {
				return err
			}
		}
	}

	if _, err := os.Stat(sink.path); err == nil {
		if err := os.Rename(sink.path, sink.rollPath(1)); err != nil {
			return err
		}
	}

	file, err := os.OpenFile(sink.path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}

	sink.file = file
	sink.size = 0
	return nil
}

func (sink *rotatingFileSink) rollPath(index int) string {
	return fmt.Sprintf("%s.%d", sink.path, index)
}
