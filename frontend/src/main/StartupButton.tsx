import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Button from 'react-bootstrap/Button'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import Dropdown from 'react-bootstrap/Dropdown'
import {
  forgetSavedEverQuestDirectoryHandle,
  getSavedEverQuestDirectoryHandle,
  saveEverQuestDirectoryHandle,
} from '../shared/directoryHandleStore'
import {
  closePipWindow,
  isDocumentPipSupported,
  openPipWindow,
} from '../shared/documentPip'
import {
  isDirectoryPickerSupported,
  pickEverQuestDirectory,
  requestReadPermission,
  validateEverQuestDirectory,
  type FileSystemDirectoryHandleLike,
} from '../shared/fileSystemAccess'
import { useRpc } from '../shared/messageBrokerHooks'

type LogStatus = 'idle' | 'reading' | 'ready'
type TriggerStatus = 'idle' | 'starting' | 'started' | 'stopping'
export type PipState = 'open' | 'closed'

interface StartupButtonProps {
  onPipChange: (state: PipState) => void
}

export function StartupButton({ onPipChange }: StartupButtonProps) {
  const callWorker = useRpc('client.startup-button')
  const [logStatus, setLogStatus] = useState<LogStatus>('idle')
  const [triggerStatus, setTriggerStatus] = useState<TriggerStatus>('idle')
  const [isWorkerPending, setIsWorkerPending] = useState(false)
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)
  const isProgrammaticallyClosingPip = useRef(false)
  const [savedDirectoryHandle, setSavedDirectoryHandle] =
    useState<FileSystemDirectoryHandleLike | null>(null)
  const [isSavedDirectoryLoaded, setIsSavedDirectoryLoaded] = useState(false)
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandleLike | null>(null)

  const hasActiveDirectoryHandle = directoryHandle !== null
  const isReadingLogs = logStatus === 'reading'
  const areTriggersStarted = triggerStatus === 'started'
  const areTriggersStarting = triggerStatus === 'starting'
  const areTriggersStopping = triggerStatus === 'stopping'
  const primaryButtonLabel = getPrimaryButtonLabel({
    areTriggersStarted,
    areTriggersStopping,
    hasActiveDirectoryHandle,
    hasSavedDirectoryHandle: savedDirectoryHandle !== null,
  })
  const canUseStoredDirectoryMenu =
    !isReadingLogs &&
    !isWorkerPending &&
    !areTriggersStarting &&
    !areTriggersStarted &&
    !areTriggersStopping &&
    !isChoosingDirectory &&
    isSavedDirectoryLoaded &&
    savedDirectoryHandle !== null
  const isReadLogsDisabled =
    isReadingLogs ||
    isWorkerPending ||
    isChoosingDirectory ||
    hasActiveDirectoryHandle ||
    !isSavedDirectoryLoaded
  const isStartTriggersDisabled =
    isWorkerPending ||
    areTriggersStarting ||
    areTriggersStopping ||
    (!areTriggersStarted && !hasActiveDirectoryHandle)
  const isPrimaryButtonDisabled = hasActiveDirectoryHandle
    ? isStartTriggersDisabled
    : isReadLogsDisabled
  const shouldShowStoredDirectoryMenu =
    savedDirectoryHandle !== null &&
    !areTriggersStarting &&
    !areTriggersStarted &&
    !areTriggersStopping

  useEffect(() => {
    let isMounted = true

    async function loadSavedDirectoryHandle() {
      try {
        const storedDirectoryHandle = await getSavedEverQuestDirectoryHandle()

        if (isMounted) {
          setSavedDirectoryHandle(storedDirectoryHandle ?? null)
        }
      } catch (error) {
        if (isMounted) {
          toast.error(getErrorMessage(error))
        }
      } finally {
        if (isMounted) {
          setIsSavedDirectoryLoaded(true)
        }
      }
    }

    void loadSavedDirectoryHandle()

    return () => {
      isMounted = false
    }
  }, [])

  async function handleReadEverQuestLogs() {
    setLogStatus('reading')

    try {
      const selectedDirectoryHandle =
        await activateEverQuestDirectoryHandle(savedDirectoryHandle)

      await setWorkerFileHandle(selectedDirectoryHandle)

      setSavedDirectoryHandle(selectedDirectoryHandle)
      setDirectoryHandle(selectedDirectoryHandle)
      setLogStatus('ready')
    } catch (error) {
      setDirectoryHandle(null)
      setLogStatus('idle')

      if (isAbortError(error)) {
        toast.error('Directory selection was canceled.')
        return
      }

      toast.error(getErrorMessage(error))
    }
  }

  async function handleStartTriggers() {
    if (areTriggersStarted) {
      void stopTriggers()
      return
    }

    setTriggerStatus('starting')

    try {
      if (!isDocumentPipSupported()) {
        throw new Error(
          'Document Picture-in-Picture is not supported in this browser.',
        )
      }

      let isPipClosedByUser = false

      await openPipWindow({
        onClose: () => {
          if (isProgrammaticallyClosingPip.current) {
            return
          }

          isPipClosedByUser = true
          setTriggerStatus('idle')
          onPipChange('closed')
          void stopWorkerWatch()
        },
      })

      if (isPipClosedByUser) {
        return
      }

      await startWorkerWatch()
      setTriggerStatus('started')
      onPipChange('open')
    } catch (error) {
      closePipProgrammatically()
      setTriggerStatus('idle')
      onPipChange('closed')
      toast.error(getErrorMessage(error))
    }
  }

  async function stopTriggers() {
    setTriggerStatus('stopping')

    try {
      await stopWorkerWatch()
      closePipProgrammatically()
      setTriggerStatus('idle')
      onPipChange('closed')
    } catch (error) {
      isProgrammaticallyClosingPip.current = false
      setTriggerStatus('started')
      toast.error(getErrorMessage(error))
    }
  }

  function handlePrimaryAction() {
    if (!hasActiveDirectoryHandle) {
      void handleReadEverQuestLogs()
      return
    }

    void handleStartTriggers()
  }

  async function handleChooseDifferentDirectory() {
    setIsChoosingDirectory(true)

    try {
      const selectedDirectoryHandle = await pickAndSaveEverQuestDirectory()

      if (hasActiveDirectoryHandle) {
        await setWorkerFileHandle(selectedDirectoryHandle)
        setDirectoryHandle(selectedDirectoryHandle)
        setLogStatus('ready')
      }

      setSavedDirectoryHandle(selectedDirectoryHandle)
      toast.success('EverQuest directory saved.')
    } catch (error) {
      if (isAbortError(error)) {
        toast.error('Directory selection was canceled.')
        return
      }

      toast.error(getErrorMessage(error))
    } finally {
      setIsChoosingDirectory(false)
    }
  }

  async function handleForgetStoredDirectory() {
    try {
      await forgetSavedEverQuestDirectoryHandle()
      setSavedDirectoryHandle(null)
      setDirectoryHandle(null)
      setLogStatus('idle')
      toast.success('Stored directory forgotten.')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function setWorkerFileHandle(
    fileHandle: FileSystemDirectoryHandleLike,
  ) {
    setIsWorkerPending(true)

    try {
      await callWorker('worker.file-watcher', 'setFileHandle', {
        fileHandle,
      })
    } finally {
      setIsWorkerPending(false)
    }
  }

  async function startWorkerWatch() {
    setIsWorkerPending(true)

    try {
      await callWorker('worker.file-watcher', 'startWatch', {})
    } finally {
      setIsWorkerPending(false)
    }
  }

  async function stopWorkerWatch() {
    setIsWorkerPending(true)

    try {
      await callWorker('worker.file-watcher', 'stopWatch', {})
    } finally {
      setIsWorkerPending(false)
    }
  }

  function closePipProgrammatically() {
    isProgrammaticallyClosingPip.current = true

    try {
      closePipWindow()
    } finally {
      isProgrammaticallyClosingPip.current = false
    }
  }

  return (
    <main className="main-view">
      {shouldShowStoredDirectoryMenu ? (
        <Dropdown as={ButtonGroup}>
          <Button
            className="startup-button"
            disabled={isPrimaryButtonDisabled}
            onClick={handlePrimaryAction}
            size="sm"
            variant="primary"
          >
            {primaryButtonLabel}
          </Button>

          <Dropdown.Toggle
            className="startup-button"
            disabled={!canUseStoredDirectoryMenu}
            id="stored-directory-actions"
            size="sm"
            split
            variant="primary"
          />

          <Dropdown.Menu>
            <Dropdown.Item onClick={handleChooseDifferentDirectory}>
              Choose different directory
            </Dropdown.Item>
            <Dropdown.Item onClick={handleForgetStoredDirectory}>
              Forget stored directory
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      ) : (
        <Button
          className="startup-button"
          disabled={isPrimaryButtonDisabled}
          onClick={handlePrimaryAction}
          size="sm"
          variant="primary"
        >
          {primaryButtonLabel}
        </Button>
      )}
    </main>
  )
}

function getPrimaryButtonLabel({
  areTriggersStarted,
  areTriggersStopping,
  hasActiveDirectoryHandle,
  hasSavedDirectoryHandle,
}: {
  areTriggersStarted: boolean
  areTriggersStopping: boolean
  hasActiveDirectoryHandle: boolean
  hasSavedDirectoryHandle: boolean
}) {
  if (areTriggersStopping) {
    return 'Stopping Triggers'
  }

  if (areTriggersStarted) {
    return 'Stop Triggers'
  }

  if (hasActiveDirectoryHandle) {
    return 'Start Triggers'
  }

  if (hasSavedDirectoryHandle) {
    return 'Open EverQuest directory'
  }

  return 'Choose EverQuest directory'
}

async function activateEverQuestDirectoryHandle(
  savedDirectoryHandle: FileSystemDirectoryHandleLike | null,
) {
  if (savedDirectoryHandle) {
    const hasPermission = await requestReadPermission(savedDirectoryHandle)

    if (!hasPermission) {
      throw new Error('Permission to read the saved directory was denied.')
    }

    await assertEverQuestDirectory(savedDirectoryHandle)
    return savedDirectoryHandle
  }

  if (!isDirectoryPickerSupported()) {
    throw new Error('Directory selection is not supported in this browser.')
  }

  const pickedDirectoryHandle = await pickEverQuestDirectory()
  return saveValidatedEverQuestDirectory(pickedDirectoryHandle)
}

async function pickAndSaveEverQuestDirectory() {
  if (!isDirectoryPickerSupported()) {
    throw new Error('Directory selection is not supported in this browser.')
  }

  const pickedDirectoryHandle = await pickEverQuestDirectory()
  return saveValidatedEverQuestDirectory(pickedDirectoryHandle)
}

async function saveValidatedEverQuestDirectory(
  directoryHandle: FileSystemDirectoryHandleLike,
) {
  await assertEverQuestDirectory(directoryHandle)
  await saveEverQuestDirectoryHandle(directoryHandle)

  return directoryHandle
}

async function assertEverQuestDirectory(
  directoryHandle: FileSystemDirectoryHandleLike,
) {
  const isEverQuestDirectory =
    await validateEverQuestDirectory(directoryHandle)

  if (!isEverQuestDirectory) {
    throw new Error('The selected directory does not contain eqgame.exe.')
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to start.'
}
