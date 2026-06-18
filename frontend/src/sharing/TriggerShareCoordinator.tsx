import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import Button from 'react-bootstrap/Button'
import Modal from 'react-bootstrap/Modal'
import toast from 'react-hot-toast'
import type { RegexMatchFoundMessage } from '../shared/messages'
import { useListen, useRpc } from '../shared/messageBrokerHooks'
import type { JenaTrigger } from '../shared/triggers'
import { useTriggerStore } from '../triggers/model/TriggerStore'
import { useTriggerManager } from '../triggers/model/UserTriggerManager'
import { TriggerTreePreview } from './TriggerTreePreview'
import './TriggerShareCoordinator.css'

const sharePattern =
  '\\{[Jj][Ee][Nn][Aa]:[Ss][Hh][Aa][Rr][Ee]:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\}'

interface ShareDialogState {
  code: string
  creatorDisplayName: string
  sharedTriggers: JenaTrigger[]
}

export function TriggerShareCoordinator({
  children,
}: {
  children: ReactNode
}) {
  const call = useRpc('trigger-share-coordinator')
  const triggerStore = useTriggerStore()
  const { triggers, upsertTriggers } = useTriggerManager()
  const [dialogState, setDialogState] = useState<ShareDialogState | null>(null)
  const dialogStateRef = useRef<ShareDialogState | null>(null)
  const processQueueRef = useRef<() => Promise<void>>(async () => undefined)
  const processingRef = useRef(false)
  const queuedCodesRef = useRef<string[]>([])
  const triggerStoreRef = useRef(triggerStore)
  const triggersRef = useRef(triggers)

  useEffect(() => {
    triggerStoreRef.current = triggerStore
  }, [triggerStore])

  useEffect(() => {
    triggersRef.current = triggers
  }, [triggers])

  useEffect(() => {
    dialogStateRef.current = dialogState
  }, [dialogState])

  useEffect(() => {
    void call('worker.matcher-service', 'add-patterns', {
      patterns: [{ pattern: sharePattern }],
    }).catch((error: unknown) => {
      console.warn('[TriggerShareCoordinator] share pattern registration failed', error)
    })
  }, [call])

  const currentTriggers = useMemo(
    () => triggers.map((resolvedTrigger) => resolvedTrigger.trigger),
    [triggers],
  )
  const currentTriggerIds = useMemo(
    () => new Set(currentTriggers.map((trigger) => trigger.id)),
    [currentTriggers],
  )
  const newSharedTriggers = useMemo(() => {
    return (dialogState?.sharedTriggers ?? []).filter(
      (trigger) => !currentTriggerIds.has(trigger.id),
    )
  }, [currentTriggerIds, dialogState])

  const processQueue = useCallback(async () => {
    if (processingRef.current || dialogStateRef.current) {
      return
    }

    const code = queuedCodesRef.current.shift()
    if (!code) {
      return
    }

    processingRef.current = true

    try {
      const resolvedPackage = await call(
        'server.sharing',
        'resolveSharePackage',
        {
          code,
        },
      )
      const sharedTriggers = await triggerStoreRef.current.fetchTriggers(
        resolvedPackage.triggerIds,
      )

      const nextDialogState = {
        code,
        creatorDisplayName: resolvedPackage.creatorDisplayName,
        sharedTriggers,
      }
      dialogStateRef.current = nextDialogState
      setDialogState(nextDialogState)
    } catch (error) {
      console.warn('[TriggerShareCoordinator] failed to resolve share package', error)
      toast.error('Unable to load shared triggers.')
    } finally {
      processingRef.current = false
    }

    if (!dialogStateRef.current) {
      queueMicrotask(() => {
        void processQueueRef.current()
      })
    }
  }, [call])

  useEffect(() => {
    processQueueRef.current = processQueue
  }, [processQueue])

  const enqueueCode = useCallback(
    (code: string) => {
      queuedCodesRef.current.push(code)
      void processQueueRef.current()
    },
    [],
  )

  const closeDialog = useCallback(() => {
    dialogStateRef.current = null
    setDialogState(null)
    queueMicrotask(() => {
      void processQueueRef.current()
    })
  }, [])

  const mergeSharedTriggers = useCallback(async () => {
    if (!dialogState) {
      return
    }

    const knownTriggerIds = new Set(
      triggersRef.current.map((resolvedTrigger) => resolvedTrigger.trigger.id),
    )
    const missingTriggers = dialogState.sharedTriggers.filter(
      (trigger) => !knownTriggerIds.has(trigger.id),
    )

    if (missingTriggers.length === 0) {
      toast('All shared triggers are already present.')
      closeDialog()
      return
    }

    try {
      await upsertTriggers(
        missingTriggers.map((trigger) => ({
          enabledFor: [],
          trigger,
        })),
      )
      toast.success(
        `Merged ${missingTriggers.length} shared trigger${
          missingTriggers.length === 1 ? '' : 's'
        }.`,
      )
      closeDialog()
    } catch (error) {
      console.warn('[TriggerShareCoordinator] failed to merge shared triggers', error)
      toast.error('Unable to merge shared triggers.')
    }
  }, [closeDialog, dialogState, upsertTriggers])

  useListen('matcher.match-found', (message) => {
    const payload = message.payload as RegexMatchFoundMessage
    if (payload.pattern !== sharePattern) {
      return
    }

    const uuid = payload.captures.positional[0]
    if (!uuid) {
      return
    }

    enqueueCode(`{JENA:share:${uuid.toLowerCase()}}`)
  })

  return (
    <>
      {children}
      <Modal
        centered
        dialogClassName="trigger-share-modal"
        onHide={closeDialog}
        show={!!dialogState}
        size="xl"
      >
        <Modal.Header closeButton>
          <Modal.Title>Shared triggers</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {dialogState ? (
            <>
              <p className="trigger-share-prompt">
                {dialogState.creatorDisplayName} is sharing triggers. Do you want
                to merge these?
              </p>
              <div className="trigger-share-panel-grid">
                <section className="trigger-share-panel">
                  <h2>Shared triggers</h2>
                  <TriggerTreePreview triggers={newSharedTriggers} />
                </section>
                <section className="trigger-share-panel">
                  <h2>Current triggers</h2>
                  <TriggerTreePreview triggers={currentTriggers} />
                </section>
              </div>
            </>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={closeDialog} variant="outline-secondary">
            Cancel
          </Button>
          <Button
            disabled={newSharedTriggers.length === 0}
            onClick={() => {
              void mergeSharedTriggers()
            }}
            variant="primary"
          >
            Merge
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
