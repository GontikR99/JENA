import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TriggerLogOutput, TriggerLogRecord } from '../model/types'

interface TriggerLogTableProps {
  onTriggerClick: (record: TriggerLogRecord) => void
  records: TriggerLogRecord[]
}

const rowHeightPx = 34

export function TriggerLogTable({
  onTriggerClick,
  records,
}: TriggerLogTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [filterText, setFilterText] = useState('')
  const visibleRecords = useMemo(
    () => filterTriggerLogRecords(records, filterText),
    [filterText, records],
  )
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: visibleRecords.length,
    estimateSize: () => rowHeightPx,
    getScrollElement: () => scrollRef.current,
    overscan: 12,
  })

  return (
    <section className="trigger-log-pane" aria-label="Trigger log">
      <div className="trigger-log-header">
        <div>Timestamp</div>
        <div>Character</div>
        <div>Trigger Name</div>
        <div className="trigger-log-line-header">
          <span className="trigger-log-line-header-label">Log Line</span>
          <input
            aria-label="Filter trigger log lines"
            className="trigger-log-filter"
            onChange={(event) => setFilterText(event.currentTarget.value)}
            placeholder="Filter"
            type="search"
            value={filterText}
          />
        </div>
      </div>

      <div className="trigger-log-scroll" ref={scrollRef}>
        {visibleRecords.length === 0 ? (
          <div className="trigger-log-empty">
            {records.length === 0
              ? 'No trigger events yet'
              : 'No trigger events match the filter'}
          </div>
        ) : (
          <div
            className="trigger-log-virtual-space"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const record = visibleRecords[virtualRow.index]

              return (
                <div
                  className="trigger-log-row"
                  key={record.id}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="trigger-log-cell">{record.timestamp}</div>
                  <div className="trigger-log-cell">
                    {record.characterName} ({record.serverName})
                  </div>
                  <div className="trigger-log-cell">
                    <button
                      className="trigger-log-link"
                      onClick={() => onTriggerClick(record)}
                      type="button"
                    >
                      {record.triggerName}
                    </button>
                  </div>
                  <div className="trigger-log-cell trigger-log-line-cell">
                    <span className="trigger-log-line-text">
                      {record.logLine}
                    </span>
                    <TriggerLogOutputBadges outputs={record.outputs} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function filterTriggerLogRecords(
  records: TriggerLogRecord[],
  filterText: string,
) {
  const normalizedFilter = filterText.trim().toLocaleLowerCase()

  if (!normalizedFilter) {
    return records
  }

  return records.filter((record) =>
    doesRecordMatchFilter(record, normalizedFilter),
  )
}

function doesRecordMatchFilter(
  record: TriggerLogRecord,
  normalizedFilter: string,
) {
  return (
    record.logLine.toLocaleLowerCase().includes(normalizedFilter) ||
    record.outputs.some((output) =>
      output.text.toLocaleLowerCase().includes(normalizedFilter),
    )
  )
}

function TriggerLogOutputBadges({
  outputs,
}: {
  outputs: TriggerLogOutput[]
}) {
  if (outputs.length === 0) {
    return null
  }

  return (
    <span className="trigger-log-output-badges">
      {outputs.map((output) => (
        <span
          aria-label={`${output.label}: ${output.text}`}
          className={`trigger-log-output-badge trigger-log-output-badge-${output.kind}`}
          key={output.kind}
          title={output.text}
        >
          {output.label}
        </span>
      ))}
    </span>
  )
}
