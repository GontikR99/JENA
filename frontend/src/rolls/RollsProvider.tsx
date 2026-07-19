import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useListen, useRpc } from '../shared/messageBrokerHooks'
import {
  createMessageId,
  type EverQuestLogFile,
  type FileWatcherLogsReadyMessage,
  type LogSearchDoneMessage,
  type LogSearchMatchMessage,
  type RegexMatchFoundMessage,
} from '../shared/messages'
import {
  addRollCandidate,
  createHistoricalRollCandidate,
  createRollCandidate,
  pruneRollHistory,
  replaceRollHistoryRange,
  rollHistoryDurationMs,
  rollPattern,
} from './rollModel'
import { RollsContext } from './rollsContext'
import type { RollRecord } from './types'
const rollPruneIntervalMs = 10_000

interface RollBackfillBatch {
  rolls: RollRecord[]
}

interface PendingRollBackfillSearch {
  batch: RollBackfillBatch
  resolve: (message: LogSearchDoneMessage) => void
}

export function RollsProvider({ children }: { children: ReactNode }) {
  const call = useRpc('rolls-provider')
  const [rolls, setRolls] = useState<RollRecord[]>([])
  const nextRollIdRef = useRef(0)
  const backfillGenerationRef = useRef(0)
  const backfillTaskRef = useRef<Promise<void>>(Promise.resolve())
  const activeBackfillSearchIdRef = useRef<string | null>(null)
  const pendingBackfillSearchesRef = useRef(
    new Map<string, PendingRollBackfillSearch>(),
  )

  const createRollId = () => {
    nextRollIdRef.current += 1
    return `roll-${nextRollIdRef.current}`
  }

  useEffect(() => {
    void call('worker.matcher-service', 'replace-patterns', {
      namespace: 'rolls',
      patterns: [{ pattern: rollPattern }],
    }).catch((error: unknown) => {
      console.warn(
        `[RollsProvider] roll pattern registration failed: ${getErrorMessage(error)}`,
      )
    })
  }, [call])

  useEffect(() => {
    const pendingSearches = pendingBackfillSearchesRef.current

    return () => {
      backfillGenerationRef.current += 1
      const searchId = activeBackfillSearchIdRef.current
      if (searchId) {
        void call('worker.file-watcher', 'cancelLogSearch', { searchId })
      }

      pendingSearches.forEach((pending, pendingSearchId) => {
        pending.resolve({
          matchCount: 0,
          searchId: pendingSearchId,
          status: 'canceled',
          truncated: false,
        })
      })
      pendingSearches.clear()
    }
  }, [call])

  useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      setRolls((currentRolls) => pruneRollHistory(currentRolls, Date.now()))
    }, rollPruneIntervalMs)

    return () => {
      globalThis.clearInterval(intervalId)
    }
  }, [])

  useListen('matcher.match-found', (message) => {
    const candidate = createRollCandidate(
      message.payload as RegexMatchFoundMessage,
    )
    if (!candidate) {
      return
    }

    setRolls((currentRolls) => {
      const nextRolls = addRollCandidate(
        currentRolls,
        candidate,
        createRollId,
      )

      return pruneRollHistory(nextRolls, Date.now())
    })
  })

  useListen('log-search.match-found', (message) => {
    const match = message.payload as LogSearchMatchMessage
    const pending = pendingBackfillSearchesRef.current.get(match.searchId)
    if (!pending) {
      return
    }

    const candidate = createHistoricalRollCandidate(match)
    if (!candidate) {
      return
    }

    pending.batch.rolls = addRollCandidate(
      pending.batch.rolls,
      candidate,
      createRollId,
    )
  })

  useListen('log-search.done', (message) => {
    const done = message.payload as LogSearchDoneMessage
    const pending = pendingBackfillSearchesRef.current.get(done.searchId)
    if (!pending) {
      return
    }

    pendingBackfillSearchesRef.current.delete(done.searchId)
    pending.resolve(done)
  })

  async function runRollBackfill(
    logs: EverQuestLogFile[],
    generation: number,
    startMs: number,
    endMs: number,
  ) {
    if (generation !== backfillGenerationRef.current) {
      return
    }

    const batch: RollBackfillBatch = { rolls: [] }
    const searchableLogs = logs.filter(
      (log) => log.lastLogWriteMs >= startMs,
    )

    for (const log of searchableLogs) {
      if (generation !== backfillGenerationRef.current) {
        return
      }

      const searchId = `roll-backfill-${createMessageId()}`
      const donePromise = new Promise<LogSearchDoneMessage>((resolve) => {
        pendingBackfillSearchesRef.current.set(searchId, { batch, resolve })
      })

      activeBackfillSearchIdRef.current = searchId

      try {
        const response = await call(
          'worker.file-watcher',
          'startLogSearch',
          {
            characterName: log.characterName,
            endMs,
            query: rollPattern,
            searchId,
            serverName: log.serverName,
            startMs,
            startPolicy: 'ifIdle',
            useRegex: true,
          },
        )

        if (!response.started) {
          pendingBackfillSearchesRef.current.delete(searchId)
          if (activeBackfillSearchIdRef.current === searchId) {
            activeBackfillSearchIdRef.current = null
          }
          return
        }
      } catch (error) {
        pendingBackfillSearchesRef.current.delete(searchId)
        if (activeBackfillSearchIdRef.current === searchId) {
          activeBackfillSearchIdRef.current = null
        }
        console.warn(
          `[RollsProvider] roll history search failed to start: ${getErrorMessage(error)}`,
        )
        return
      }

      const done = await donePromise
      if (activeBackfillSearchIdRef.current === searchId) {
        activeBackfillSearchIdRef.current = null
      }

      if (
        generation !== backfillGenerationRef.current ||
        done.status !== 'complete' ||
        done.truncated
      ) {
        return
      }
    }

    setRolls((currentRolls) => {
      if (generation !== backfillGenerationRef.current) {
        return currentRolls
      }

      return replaceRollHistoryRange(
        currentRolls,
        batch.rolls,
        startMs,
        endMs,
        Date.now(),
      )
    })
  }

  useListen('file-watcher.logs-ready', (message) => {
    const { logs } = message.payload as FileWatcherLogsReadyMessage
    const generation = backfillGenerationRef.current + 1
    backfillGenerationRef.current = generation
    const currentSearchId = activeBackfillSearchIdRef.current

    if (currentSearchId) {
      void call('worker.file-watcher', 'cancelLogSearch', {
        searchId: currentSearchId,
      })
    }

    const endMs = Date.now()
    const startMs = endMs - rollHistoryDurationMs
    const previousTask = backfillTaskRef.current
    const nextTask = previousTask
      .catch(() => undefined)
      .then(() => runRollBackfill(logs, generation, startMs, endMs))

    backfillTaskRef.current = nextTask
  })

  const value = useMemo(() => ({ rolls }), [rolls])

  return <RollsContext.Provider value={value}>{children}</RollsContext.Provider>
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
