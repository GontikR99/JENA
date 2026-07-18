import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useListen, useRpc } from '../shared/messageBrokerHooks'
import type { RegexMatchFoundMessage } from '../shared/messages'
import {
  addRollCandidate,
  createRollCandidate,
  pruneRollHistory,
  rollPattern,
} from './rollModel'
import { RollsContext } from './rollsContext'
import type { RollRecord } from './types'
const rollPruneIntervalMs = 10_000

export function RollsProvider({ children }: { children: ReactNode }) {
  const call = useRpc('rolls-provider')
  const [rolls, setRolls] = useState<RollRecord[]>([])
  const nextRollIdRef = useRef(0)

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
        () => {
          nextRollIdRef.current += 1
          return `roll-${nextRollIdRef.current}`
        },
      )

      return pruneRollHistory(nextRolls, Date.now())
    })
  })

  const value = useMemo(() => ({ rolls }), [rolls])

  return <RollsContext.Provider value={value}>{children}</RollsContext.Provider>
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
