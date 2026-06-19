import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TriggerLogRecord } from '../model/types'

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
  const rowVirtualizer = useVirtualizer({
    count: records.length,
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
        <div>Log Line</div>
      </div>

      <div className="trigger-log-scroll" ref={scrollRef}>
        {records.length === 0 ? (
          <div className="trigger-log-empty">No trigger events yet</div>
        ) : (
          <div
            className="trigger-log-virtual-space"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const record = records[virtualRow.index]

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
                  <div className="trigger-log-cell">{record.logLine}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
