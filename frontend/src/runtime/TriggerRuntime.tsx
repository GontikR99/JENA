import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Pip } from '../pip/pip'
import {
  createDocumentPipHost,
  isDocumentPipSupported,
  type DocumentPipHost,
} from '../shared/documentPipHost'

type TriggerRuntimeStatus = 'stopped' | 'starting' | 'running' | 'stopping'

interface TriggerRuntimeContextValue {
  areTriggersRunning: boolean
  canUseTriggerRuntime: boolean
  isStartingTriggers: boolean
  isStoppingTriggers: boolean
  startTriggers: () => Promise<void>
  stopTriggers: () => void
}

interface TriggerRuntimeInternalContextValue {
  pipContainer: HTMLElement | null
}

const pipWindowOptions = {
  height: 180,
  width: 320,
}

const TriggerRuntimeContext =
  createContext<TriggerRuntimeContextValue | null>(null)
const TriggerRuntimeInternalContext =
  createContext<TriggerRuntimeInternalContextValue | null>(null)

export function TriggerRuntimeProvider({
  children,
}: {
  children: ReactNode
}) {
  const [status, setStatus] = useState<TriggerRuntimeStatus>('stopped')
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null)
  const pipHostRef = useRef<DocumentPipHost | null>(null)

  const handlePipClosed = useCallback(() => {
    pipHostRef.current = null
    setPipContainer(null)
    setStatus('stopped')
  }, [])

  const startTriggers = useCallback(async () => {
    if (pipHostRef.current) {
      pipHostRef.current.window.focus()
      setStatus('running')
      return
    }

    setStatus('starting')

    try {
      const host = await createDocumentPipHost({
        ...pipWindowOptions,
        onClose: handlePipClosed,
        title: 'JENA',
      })

      pipHostRef.current = host
      setPipContainer(host.container)
      setStatus('running')
    } catch (error) {
      pipHostRef.current = null
      setPipContainer(null)
      setStatus('stopped')
      throw error
    }
  }, [handlePipClosed])

  const stopTriggers = useCallback(() => {
    if (!pipHostRef.current) {
      setStatus('stopped')
      setPipContainer(null)
      return
    }

    setStatus('stopping')
    pipHostRef.current.close()
  }, [])

  useEffect(() => {
    return () => {
      pipHostRef.current?.close()
    }
  }, [])

  const publicValue = useMemo<TriggerRuntimeContextValue>(
    () => ({
      areTriggersRunning: status === 'running',
      canUseTriggerRuntime: isDocumentPipSupported(),
      isStartingTriggers: status === 'starting',
      isStoppingTriggers: status === 'stopping',
      startTriggers,
      stopTriggers,
    }),
    [startTriggers, status, stopTriggers],
  )
  const internalValue = useMemo<TriggerRuntimeInternalContextValue>(
    () => ({
      pipContainer,
    }),
    [pipContainer],
  )

  return (
    <TriggerRuntimeContext.Provider value={publicValue}>
      <TriggerRuntimeInternalContext.Provider value={internalValue}>
        {children}
      </TriggerRuntimeInternalContext.Provider>
    </TriggerRuntimeContext.Provider>
  )
}

export function TriggerRuntimePortal() {
  const { pipContainer } = useTriggerRuntimeInternal()

  return pipContainer ? createPortal(<Pip />, pipContainer) : null
}

export function useTriggerRuntime() {
  const context = useContext(TriggerRuntimeContext)

  if (!context) {
    throw new Error('useTriggerRuntime must be used within TriggerRuntimeProvider.')
  }

  return context
}

function useTriggerRuntimeInternal() {
  const context = useContext(TriggerRuntimeInternalContext)

  if (!context) {
    throw new Error(
      'TriggerRuntimePortal must be used within TriggerRuntimeProvider.',
    )
  }

  return context
}
