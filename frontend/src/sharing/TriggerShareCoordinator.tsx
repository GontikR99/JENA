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
import ProgressBar from 'react-bootstrap/ProgressBar'
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
const mergeTriggerChunkSize = 100

interface ShareDialogState {
  code: string
  creatorDisplayName: string
  sharedTriggers: JenaTrigger[]
}

interface MergeProgress {
  processedCount: number
  totalCount: number
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
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null)
  const dialogStateRef = useRef<ShareDialogState | null>(null)
  const mergeProgressRef = useRef<MergeProgress | null>(null)
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
    mergeProgressRef.current = mergeProgress
  }, [mergeProgress])

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
      const knownTriggerIds = new Set(
        triggersRef.current.map((resolvedTrigger) => resolvedTrigger.trigger.id),
      )
      const missingTriggers = getMissingTriggers(sharedTriggers, knownTriggerIds)

      if (missingTriggers.length === 0) {
        toast('All shared triggers are already present.')
        return
      }

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
    if (mergeProgressRef.current) {
      return
    }

    dialogStateRef.current = null
    mergeProgressRef.current = null
    setDialogState(null)
    setMergeProgress(null)
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
    const missingTriggers = getMissingTriggers(
      dialogState.sharedTriggers,
      knownTriggerIds,
    )

    if (missingTriggers.length === 0) {
      toast('All shared triggers are already present.')
      closeDialog()
      return
    }

    try {
      const chunks = chunkArray(missingTriggers, mergeTriggerChunkSize)
      const initialProgress = {
        processedCount: 0,
        totalCount: missingTriggers.length,
      }
      mergeProgressRef.current = initialProgress
      setMergeProgress(initialProgress)

      for (const chunk of chunks) {
        await upsertTriggers(
          chunk.map((trigger) => ({
            enabledFor: [],
            trigger,
          })),
        )
        mergeProgressRef.current = {
          processedCount: Math.min(
            missingTriggers.length,
            (mergeProgressRef.current?.processedCount ?? 0) + chunk.length,
          ),
          totalCount: missingTriggers.length,
        }
        setMergeProgress((current) =>
          current
            ? {
                ...current,
                processedCount: Math.min(
                  current.totalCount,
                  current.processedCount + chunk.length,
                ),
              }
            : current,
        )
        await yieldToEventLoop()
      }

      toast.success(
        `Merged ${missingTriggers.length} shared trigger${
          missingTriggers.length === 1 ? '' : 's'
        }.`,
      )
      mergeProgressRef.current = null
      setMergeProgress(null)
      closeDialog()
    } catch (error) {
      console.warn('[TriggerShareCoordinator] failed to merge shared triggers', error)
      mergeProgressRef.current = null
      setMergeProgress(null)
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
        backdrop={mergeProgress ? 'static' : true}
        centered
        dialogClassName="trigger-share-modal"
        keyboard={!mergeProgress}
        onHide={closeDialog}
        show={!!dialogState}
        size="xl"
      >
        <Modal.Header closeButton={!mergeProgress}>
          <Modal.Title>Shared triggers</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {mergeProgress ? (
            <MergeProgressPanel progress={mergeProgress} />
          ) : dialogState ? (
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
          <Button
            disabled={!!mergeProgress}
            onClick={closeDialog}
            variant="outline-secondary"
          >
            Cancel
          </Button>
          <Button
            disabled={newSharedTriggers.length === 0 || !!mergeProgress}
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

function MergeProgressPanel({ progress }: { progress: MergeProgress }) {
  const progressPercent =
    progress.totalCount > 0
      ? Math.round((progress.processedCount / progress.totalCount) * 100)
      : 0

  return (
    <div className="trigger-share-progress" role="status">
      <div className="trigger-share-progress-title">Merging shared triggers</div>
      <div className="trigger-share-progress-status">
        {progress.processedCount} / {progress.totalCount} triggers
      </div>
      <ProgressBar
        animated
        now={progressPercent}
        striped
        variant="success"
      />
    </div>
  )
}

function getMissingTriggers(
  sharedTriggers: JenaTrigger[],
  knownTriggerIds: Set<string>,
) {
  return sharedTriggers.filter((trigger) => !knownTriggerIds.has(trigger.id))
}

function chunkArray<TItem>(items: TItem[], chunkSize: number) {
  const chunks: TItem[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}
