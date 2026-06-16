package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	elasticsearchBatchSize    = 100
	elasticsearchChannelDepth = 1024
	elasticsearchFlushEvery   = time.Second
)

type elasticsearchSinkOptions struct {
	client      *http.Client
	indexPrefix string
	output      io.Writer
	url         string
}

type elasticsearchSink struct {
	client      *http.Client
	done        chan struct{}
	indexPrefix string
	output      io.Writer
	queue       chan entry
	url         string
	waitGroup   sync.WaitGroup
}

func newElasticsearchSink(options elasticsearchSinkOptions) (*elasticsearchSink, error) {
	if _, err := url.ParseRequestURI(options.url); err != nil {
		return nil, fmt.Errorf("parse elasticsearch url: %w", err)
	}

	client := options.client
	if client == nil {
		client = http.DefaultClient
	}

	sink := &elasticsearchSink{
		client:      client,
		done:        make(chan struct{}),
		indexPrefix: options.indexPrefix,
		output:      options.output,
		queue:       make(chan entry, elasticsearchChannelDepth),
		url:         strings.TrimRight(options.url, "/"),
	}
	sink.waitGroup.Add(1)
	go sink.run()

	return sink, nil
}

func (sink *elasticsearchSink) Close() error {
	close(sink.done)
	sink.waitGroup.Wait()
	return nil
}

func (sink *elasticsearchSink) Write(_ context.Context, logEntry entry) error {
	select {
	case sink.queue <- logEntry:
		return nil
	default:
		_, _ = fmt.Fprintln(sink.output, "logging failure: elasticsearch log queue is full")
		return nil
	}
}

func (sink *elasticsearchSink) run() {
	defer sink.waitGroup.Done()

	ticker := time.NewTicker(elasticsearchFlushEvery)
	defer ticker.Stop()

	batch := make([]entry, 0, elasticsearchBatchSize)

	for {
		select {
		case logEntry := <-sink.queue:
			batch = append(batch, logEntry)
			if len(batch) >= elasticsearchBatchSize {
				sink.flush(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				sink.flush(batch)
				batch = batch[:0]
			}
		case <-sink.done:
			for {
				select {
				case logEntry := <-sink.queue:
					batch = append(batch, logEntry)
				default:
					if len(batch) > 0 {
						sink.flush(batch)
					}
					return
				}
			}
		}
	}
}

func (sink *elasticsearchSink) flush(batch []entry) {
	payload, err := sink.bulkPayload(batch)
	if err != nil {
		_, _ = fmt.Fprintf(sink.output, "logging failure: %v\n", err)
		return
	}

	request, err := http.NewRequest(http.MethodPost, sink.url+"/_bulk", bytes.NewReader(payload))
	if err != nil {
		_, _ = fmt.Fprintf(sink.output, "logging failure: %v\n", err)
		return
	}
	request.Header.Set("Content-Type", "application/x-ndjson")

	response, err := sink.client.Do(request)
	if err != nil {
		_, _ = fmt.Fprintf(sink.output, "logging failure: %v\n", err)
		return
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = fmt.Fprintf(sink.output, "logging failure: elasticsearch status %d\n", response.StatusCode)
	}
}

func (sink *elasticsearchSink) bulkPayload(batch []entry) ([]byte, error) {
	var buffer bytes.Buffer

	for _, logEntry := range batch {
		action := map[string]map[string]string{
			"index": {
				"_index": sink.indexName(logEntry.timestamp),
			},
		}
		actionBytes, err := json.Marshal(action)
		if err != nil {
			return nil, err
		}
		buffer.Write(actionBytes)
		buffer.WriteByte('\n')

		record, err := entryRecord(logEntry)
		if err != nil {
			return nil, err
		}
		recordBytes, err := json.Marshal(record)
		if err != nil {
			return nil, err
		}
		buffer.Write(recordBytes)
		buffer.WriteByte('\n')
	}

	return buffer.Bytes(), nil
}

func (sink *elasticsearchSink) indexName(timestamp time.Time) string {
	return strings.ToLower(sink.indexPrefix + timestamp.UTC().Format("2006.01.02"))
}
