import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ControlledMenu,
  MenuDivider,
  MenuItem,
  useMenuState,
} from '@szhsin/react-menu'
import { useVirtualizer } from '@tanstack/react-virtual'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import toast from 'react-hot-toast'
import type {
  EverQuestCharacter,
  FileWatcherCharactersMessage,
  LogSearchDoneMessage,
  LogSearchMatchMessage,
} from '../shared/messages'
import { createMessageId } from '../shared/messages'
import { useListen, useRpc } from '../shared/messageBrokerHooks'
import { BINARY, FourStateCheckbox } from '../shared/widgets/FourStateCheckbox'
import './SearchView.css'

type SearchStatus = 'canceled' | 'complete' | 'error' | 'idle' | 'running'
type SortDirection = 'asc' | 'desc'
type SortKey = 'character' | 'text' | 'timestamp'

interface SearchResult extends LogSearchMatchMessage {
  id: string
}

interface SortSpec {
  direction: SortDirection
  key: SortKey
}

interface SearchSelection {
  anchorId: string | null
  ids: Set<string>
}

const defaultRangeMs = 5 * 60 * 1000
const rowHeightPx = 34
const rangePresets = [
  { label: 'Last 1 minute', ms: 60 * 1000 },
  { label: 'Last 5 minutes', ms: 5 * 60 * 1000 },
  { label: 'Last 10 minutes', ms: 10 * 60 * 1000 },
  { label: 'Last 15 minutes', ms: 15 * 60 * 1000 },
  { label: 'Last hour', ms: 60 * 60 * 1000 },
  { label: 'Last 4 hours', ms: 4 * 60 * 60 * 1000 },
  { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
]
const contextRanges = [
  { label: 'Within 1 second', ms: 1000 },
  { label: 'Within 5 seconds', ms: 5000 },
  { label: 'Within 10 seconds', ms: 10_000 },
  { label: 'Within a minute', ms: 60_000 },
  { label: 'Within 5 minutes', ms: 5 * 60_000 },
]

export function SearchView() {
  const callWorker = useRpc('search-view')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const currentSearchIdRef = useRef<string | null>(null)
  const nextSearchIdRef = useRef(0)
  const [characters, setCharacters] = useState<EverQuestCharacter[]>([])
  const [selectedCharacterKey, setSelectedCharacterKey] = useState('')
  const [startMs, setStartMs] = useState(() => Date.now() - defaultRangeMs)
  const [endMs, setEndMs] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [results, setResults] = useState<SearchResult[]>([])
  const [matchCount, setMatchCount] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [sortStack, setSortStack] = useState<SortSpec[]>([
    { direction: 'asc', key: 'timestamp' },
  ])
  const [selection, setSelection] = useState<SearchSelection>({
    anchorId: null,
    ids: new Set(),
  })
  const [contextResult, setContextResult] = useState<SearchResult | null>(null)
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 })
  const [{ state: menuState, endTransition }, setMenuOpen] = useMenuState()

  const sortedCharacters = useMemo(() => sortCharacters(characters), [characters])
  const selectedCharacter = useMemo(
    () =>
      sortedCharacters.find(
        (character) => getCharacterKey(character) === selectedCharacterKey,
      ) ?? null,
    [selectedCharacterKey, sortedCharacters],
  )
  const visibleResults = useMemo(
    () => sortResults(results, sortStack),
    [results, sortStack],
  )
  const rowVirtualizer = useVirtualizer({
    count: visibleResults.length,
    estimateSize: () => rowHeightPx,
    getScrollElement: () => scrollRef.current,
    overscan: 16,
  })
  const isRunning = status === 'running'

  useEffect(() => {
    let canceled = false

    async function loadCharacters() {
      try {
        const response = await callWorker(
          'worker.file-watcher',
          'getCharacters',
          {},
        )
        if (!canceled) {
          setCharacters(response.characters)
        }
      } catch (loadError) {
        toast.error(getErrorMessage(loadError))
      }
    }

    void loadCharacters()

    return () => {
      canceled = true
    }
  }, [callWorker])

  useEffect(() => {
    if (
      selectedCharacterKey &&
      sortedCharacters.some(
        (character) => getCharacterKey(character) === selectedCharacterKey,
      )
    ) {
      return
    }

    setSelectedCharacterKey(
      getCharacterKey(
        sortedCharacters.find((character) => character.active) ??
          sortedCharacters[0],
      ),
    )
  }, [selectedCharacterKey, sortedCharacters])

  useListen('file-watcher.characters', (message) => {
    setCharacters((message.payload as FileWatcherCharactersMessage).characters)
  })

  useListen('log-search.match-found', (message) => {
    const payload = message.payload as LogSearchMatchMessage
    if (payload.searchId !== currentSearchIdRef.current) {
      return
    }

    setResults((currentResults) => [
      ...currentResults,
      {
        ...payload,
        id: `${payload.searchId}:${payload.index}`,
      },
    ])
  })

  useListen('log-search.done', (message) => {
    const payload = message.payload as LogSearchDoneMessage
    if (payload.searchId !== currentSearchIdRef.current) {
      return
    }

    setStatus(payload.status)
    setMatchCount(payload.matchCount)
    setTruncated(payload.truncated)
    setError(payload.error ?? '')
  })

  async function startSearch(
    overrides: Partial<{ endMs: number; startMs: number }> = {},
  ) {
    if (!selectedCharacter) {
      toast.error('Select a character to search.')
      return
    }

    const nextStartMs = overrides.startMs ?? startMs
    const nextEndMs = overrides.endMs ?? endMs
    if (nextEndMs < nextStartMs) {
      toast.error('Search end time must be after start time.')
      return
    }

    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      toast.error('Enter search text.')
      return
    }

    nextSearchIdRef.current += 1
    const searchId = `${createMessageId()}-${nextSearchIdRef.current}`
    currentSearchIdRef.current = searchId
    setResults([])
    setSelection(createEmptySelection())
    setMatchCount(0)
    setTruncated(false)
    setError('')
    setStatus('running')
    setStartMs(nextStartMs)
    setEndMs(nextEndMs)

    try {
      await callWorker('worker.file-watcher', 'startLogSearch', {
        characterName: selectedCharacter.characterName,
        endMs: nextEndMs,
        query: trimmedQuery,
        searchId,
        serverName: selectedCharacter.serverName,
        startMs: nextStartMs,
        useRegex,
      })
    } catch (startError) {
      setStatus('error')
      setError(getErrorMessage(startError))
      toast.error(getErrorMessage(startError))
    }
  }

  async function cancelSearch() {
    const searchId = currentSearchIdRef.current
    if (!searchId || !isRunning) {
      return
    }

    try {
      await callWorker('worker.file-watcher', 'cancelLogSearch', {
        searchId,
      })
    } catch (cancelError) {
      toast.error(getErrorMessage(cancelError))
    }
  }

  async function searchAround(result: SearchResult, rangeMs: number) {
    if (isRunning) {
      await cancelSearch()
    }

    const nextStartMs = result.timestampMs - rangeMs
    const nextEndMs = result.timestampMs + rangeMs
    await startSearch({
      endMs: nextEndMs,
      startMs: nextStartMs,
    })
  }

  function applyPreset(rangeMs: number) {
    const now = Date.now()
    setStartMs(now - rangeMs)
    setEndMs(now)
  }

  function handleSortClick(key: SortKey) {
    setSortStack((currentStack) => {
      const existing = currentStack.find((spec) => spec.key === key)
      const rest = currentStack.filter((spec) => spec.key !== key)

      return [
        {
          direction:
            existing?.direction === 'asc' && currentStack[0]?.key === key
              ? 'desc'
              : 'asc',
          key,
        },
        ...rest,
      ]
    })
  }

  function handleRowClick(event: React.MouseEvent, result: SearchResult) {
    event.preventDefault()

    if (event.shiftKey && selection.anchorId) {
      setSelection({
        anchorId: selection.anchorId,
        ids: selectResultRange(visibleResults, selection.anchorId, result.id),
      })
      return
    }

    if (event.ctrlKey || event.metaKey) {
      setSelection((currentSelection) => {
        const nextIds = new Set(currentSelection.ids)
        if (nextIds.has(result.id)) {
          nextIds.delete(result.id)
        } else {
          nextIds.add(result.id)
        }

        return nextIds.size > 0
          ? {
              anchorId: result.id,
              ids: nextIds,
            }
          : createEmptySelection()
      })
      return
    }

    setSelection({
      anchorId: result.id,
      ids: new Set([result.id]),
    })
  }

  function handleRowContextMenu(event: React.MouseEvent, result: SearchResult) {
    event.preventDefault()
    setContextResult(result)
    setAnchorPoint({ x: event.clientX, y: event.clientY })

    if (!selection.ids.has(result.id)) {
      setSelection({
        anchorId: result.id,
        ids: new Set([result.id]),
      })
    }

    setMenuOpen(true)
  }

  async function copyContextSelection() {
    if (!contextResult) {
      return
    }

    const selectedResults = getContextSelectionResults(
      visibleResults,
      selection,
      contextResult,
    )
    const lineSeparator = getPlatformLineSeparator()
    const text = selectedResults
      .map((result) => result.rawLine)
      .join(lineSeparator)

    try {
      await navigator.clipboard.writeText(text)
      toast.success(
        `Copied ${selectedResults.length} line${selectedResults.length === 1 ? '' : 's'}.`,
      )
    } catch (copyError) {
      toast.error(getErrorMessage(copyError))
    }
  }

  return (
    <section className="search-view">
      <div className="search-controls">
        <div className="search-control-group">
          <label className="search-control-label" htmlFor="search-character">
            Character
          </label>
          <Form.Select
            disabled={isRunning}
            id="search-character"
            onChange={(event) => setSelectedCharacterKey(event.target.value)}
            size="sm"
            value={selectedCharacterKey}
          >
            {sortedCharacters.length === 0 ? (
              <option value="">No characters available</option>
            ) : null}
            {sortedCharacters.map((character) => (
              <option key={getCharacterKey(character)} value={getCharacterKey(character)}>
                {character.characterName} ({character.serverName})
                {character.active ? ' *' : ''}
              </option>
            ))}
          </Form.Select>
        </div>

        <div className="search-control-group">
          <div className="search-control-label">Date range</div>
          <div className="search-control-row">
            <Form.Control
              disabled={isRunning}
              onChange={(event) => setStartMs(datetimeLocalToMs(event.target.value))}
              size="sm"
              type="datetime-local"
              value={msToDatetimeLocal(startMs)}
            />
            <Form.Control
              disabled={isRunning}
              onChange={(event) => setEndMs(datetimeLocalToMs(event.target.value))}
              size="sm"
              type="datetime-local"
              value={msToDatetimeLocal(endMs)}
            />
          </div>
          <div className="search-presets">
            {rangePresets.map((preset) => (
              <Button
                disabled={isRunning}
                key={preset.label}
                onClick={() => applyPreset(preset.ms)}
                size="sm"
                variant="outline-secondary"
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="search-control-group">
          <label className="search-control-label" htmlFor="search-query">
            Search text
          </label>
          <Form.Control
            disabled={isRunning}
            id="search-query"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isRunning) {
                void startSearch()
              }
            }}
            size="sm"
            value={query}
          />
          <FourStateCheckbox
            id="search-use-regex"
            label="Use regex"
            mode={BINARY}
            onChange={(state) => setUseRegex(state === 'enabled')}
            state={useRegex ? 'enabled' : 'disabled'}
          />
        </div>

        <div className="search-control-group">
          <Button
            disabled={isRunning}
            onClick={() => {
              void startSearch()
            }}
            size="sm"
          >
            Start
          </Button>
          <Button
            disabled={!isRunning}
            onClick={() => {
              void cancelSearch()
            }}
            size="sm"
            variant="outline-secondary"
          >
            Cancel
          </Button>
        </div>
      </div>

      <div className="search-status">
        {getStatusText(status, matchCount, truncated, error)}
      </div>

      <section className="search-table-panel" aria-label="Search results">
        <div className="search-table-header">
          <SortHeader
            label="Timestamp"
            onClick={() => handleSortClick('timestamp')}
            sortKey="timestamp"
            sortStack={sortStack}
          />
          <SortHeader
            label="Character"
            onClick={() => handleSortClick('character')}
            sortKey="character"
            sortStack={sortStack}
          />
          <SortHeader
            label="Log Text"
            onClick={() => handleSortClick('text')}
            sortKey="text"
            sortStack={sortStack}
          />
        </div>

        <div className="search-table-scroll" ref={scrollRef}>
          {visibleResults.length === 0 ? (
            <div className="search-table-empty">No search results</div>
          ) : (
            <div
              className="search-table-virtual-space"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const result = visibleResults[virtualRow.index]

                return (
                  <div
                    aria-selected={selection.ids.has(result.id)}
                    className="search-table-row"
                    key={result.id}
                    onClick={(event) => handleRowClick(event, result)}
                    onContextMenu={(event) => handleRowContextMenu(event, result)}
                    role="row"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    tabIndex={0}
                  >
                    <div className="search-table-cell">{result.timestamp}</div>
                    <div className="search-table-cell">
                      {result.characterName} ({result.serverName})
                    </div>
                    <div className="search-table-cell">{result.text}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <ControlledMenu
        anchorPoint={anchorPoint}
        endTransition={endTransition}
        onClose={() => setMenuOpen(false)}
        state={menuState}
      >
        {contextRanges.map((range) => (
          <MenuItem
            disabled={!contextResult}
            key={range.label}
            onClick={() => {
              if (contextResult) {
                void searchAround(contextResult, range.ms)
              }
            }}
          >
            {range.label}
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem
          disabled={!contextResult}
          onClick={() => {
            void copyContextSelection()
          }}
        >
          Copy to clipboard
        </MenuItem>
      </ControlledMenu>
    </section>
  )
}

function SortHeader({
  label,
  onClick,
  sortKey,
  sortStack,
}: {
  label: string
  onClick: () => void
  sortKey: SortKey
  sortStack: SortSpec[]
}) {
  const sortIndex = sortStack.findIndex((spec) => spec.key === sortKey)
  const sortSpec = sortStack[sortIndex]
  const suffix = sortSpec
    ? ` ${sortSpec.direction} ${sortIndex + 1}`
    : ''

  return (
    <button onClick={onClick} type="button">
      {label}
      {suffix}
    </button>
  )
}

function sortCharacters(characters: EverQuestCharacter[]) {
  return [...characters].sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1
    }

    return compareCharacterLabels(left, right)
  })
}

function sortResults(results: SearchResult[], sortStack: SortSpec[]) {
  return [...results].sort((left, right) => {
    for (const sortSpec of sortStack) {
      const comparison = compareResults(left, right, sortSpec.key)
      if (comparison !== 0) {
        return sortSpec.direction === 'asc' ? comparison : -comparison
      }
    }

    return left.index - right.index
  })
}

function compareResults(left: SearchResult, right: SearchResult, key: SortKey) {
  switch (key) {
    case 'timestamp':
      return left.timestampMs - right.timestampMs
    case 'character':
      return compareText(
        `${left.characterName}\0${left.serverName}`,
        `${right.characterName}\0${right.serverName}`,
      )
    case 'text':
      return compareText(left.text, right.text)
  }
}

function compareCharacterLabels(
  left: EverQuestCharacter,
  right: EverQuestCharacter,
) {
  return compareText(
    `${left.characterName}\0${left.serverName}`,
    `${right.characterName}\0${right.serverName}`,
  )
}

function selectResultRange(
  visibleResults: SearchResult[],
  anchorId: string,
  targetId: string,
) {
  const anchorIndex = visibleResults.findIndex((result) => result.id === anchorId)
  const targetIndex = visibleResults.findIndex((result) => result.id === targetId)
  if (anchorIndex < 0 || targetIndex < 0) {
    return new Set([targetId])
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return new Set(visibleResults.slice(start, end + 1).map((result) => result.id))
}

function getContextSelectionResults(
  visibleResults: SearchResult[],
  selection: SearchSelection,
  contextResult: SearchResult,
) {
  if (!selection.ids.has(contextResult.id)) {
    return [contextResult]
  }

  return visibleResults.filter((result) => selection.ids.has(result.id))
}

function createEmptySelection(): SearchSelection {
  return {
    anchorId: null,
    ids: new Set(),
  }
}

function msToDatetimeLocal(value: number) {
  const date = new Date(value)
  return [
    date.getFullYear().toString().padStart(4, '0'),
    '-',
    (date.getMonth() + 1).toString().padStart(2, '0'),
    '-',
    date.getDate().toString().padStart(2, '0'),
    'T',
    date.getHours().toString().padStart(2, '0'),
    ':',
    date.getMinutes().toString().padStart(2, '0'),
  ].join('')
}

function datetimeLocalToMs(value: string) {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Date.now()
}

function getCharacterKey(character: EverQuestCharacter | undefined) {
  if (!character) {
    return ''
  }

  return `${character.serverName.toLocaleLowerCase()}\0${character.characterName.toLocaleLowerCase()}`
}

function getStatusText(
  status: SearchStatus,
  matchCount: number,
  truncated: boolean,
  error: string,
) {
  switch (status) {
    case 'idle':
      return 'Ready'
    case 'running':
      return `Searching... ${matchCount} match${matchCount === 1 ? '' : 'es'} found`
    case 'complete':
      return `Search complete. ${matchCount} match${matchCount === 1 ? '' : 'es'} found${truncated ? ' (stopped at 5000)' : ''}.`
    case 'canceled':
      return `Search canceled. ${matchCount} match${matchCount === 1 ? '' : 'es'} found.`
    case 'error':
      return `Search failed: ${error}`
  }
}

function getPlatformLineSeparator() {
  return navigator.platform.toLocaleLowerCase().includes('win') ? '\r\n' : '\n'
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
