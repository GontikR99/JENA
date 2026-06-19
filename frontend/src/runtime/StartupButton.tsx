import { useEffect, useState } from 'react'
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
  isDirectoryPickerSupported,
  pickEverQuestDirectory,
  requestReadPermission,
  validateEverQuestDirectory,
  type FileSystemDirectoryHandleLike,
} from '../shared/fileSystemAccess'
import { useRpc } from '../shared/messageBrokerHooks'
import { useSettings } from '../settings/settingsContext'
import { useTriggerRuntime } from './TriggerRuntime'

type LogStatus = 'idle' | 'reading' | 'ready'

interface StartupButtonProps {
  onDirectoryOpened?: () => void
}

export function StartupButton({ onDirectoryOpened }: StartupButtonProps) {
  const callWorker = useRpc('startup-button')
  const { machineSettings } = useSettings()
  const {
    areTriggersRunning,
    canUseTriggerRuntime,
    isStartingTriggers,
    isStoppingTriggers,
    startTriggers,
    stopTriggers,
  } = useTriggerRuntime()
  const [logStatus, setLogStatus] = useState<LogStatus>('idle')
  const [isWorkerPending, setIsWorkerPending] = useState(false)
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)
  const [savedDirectoryHandle, setSavedDirectoryHandle] =
    useState<FileSystemDirectoryHandleLike | null>(null)
  const [isSavedDirectoryLoaded, setIsSavedDirectoryLoaded] = useState(false)
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandleLike | null>(null)

  const hasActiveDirectoryHandle = directoryHandle !== null
  const isReadingLogs = logStatus === 'reading'
  const primaryButtonLabel = getPrimaryButtonLabel({
    areTriggersRunning,
    headlessMode: machineSettings.headlessMode,
    isStartingTriggers,
    isStoppingTriggers,
    hasActiveDirectoryHandle,
    hasSavedDirectoryHandle: savedDirectoryHandle !== null,
  })
  const canUseStoredDirectoryMenu =
    !isReadingLogs &&
    !isWorkerPending &&
    !isStartingTriggers &&
    !areTriggersRunning &&
    !isStoppingTriggers &&
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
    isStartingTriggers ||
    isStoppingTriggers ||
    !canUseTriggerRuntime ||
    (!areTriggersRunning && !hasActiveDirectoryHandle)
  const isPrimaryButtonDisabled = hasActiveDirectoryHandle
    ? isStartTriggersDisabled
    : isReadLogsDisabled
  const shouldShowStoredDirectoryMenu =
    savedDirectoryHandle !== null &&
    !isStartingTriggers &&
    !areTriggersRunning &&
    !isStoppingTriggers

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
      onDirectoryOpened?.()
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
    if (areTriggersRunning) {
      stopTriggers()
      return
    }

    try {
      if (!canUseTriggerRuntime) {
        throw new Error(
          'Document Picture-in-Picture is not supported in this browser.',
        )
      }

      await startTriggers()
    } catch (error) {
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
        onDirectoryOpened?.()
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
      await setWorkerFileHandle(null)
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
    fileHandle: FileSystemDirectoryHandleLike | null,
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

  return (
    <>
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
    </>
  )
}

function getPrimaryButtonLabel({
  areTriggersRunning,
  headlessMode,
  isStartingTriggers,
  isStoppingTriggers,
  hasActiveDirectoryHandle,
  hasSavedDirectoryHandle,
}: {
  areTriggersRunning: boolean
  headlessMode: boolean
  isStartingTriggers: boolean
  isStoppingTriggers: boolean
  hasActiveDirectoryHandle: boolean
  hasSavedDirectoryHandle: boolean
}) {
  if (isStartingTriggers) {
    return headlessMode ? 'Showing Overlay' : 'Starting Triggers'
  }

  if (isStoppingTriggers) {
    return headlessMode ? 'Hiding Overlay' : 'Stopping Triggers'
  }

  if (areTriggersRunning) {
    return headlessMode ? 'Hide Overlay' : 'Stop Triggers'
  }

  if (hasActiveDirectoryHandle) {
    return headlessMode ? 'Show Overlay' : 'Start Triggers'
  }

  if (hasSavedDirectoryHandle) {
    return 'Open EverQuest Directory'
  }

  return 'Choose EverQuest Directory'
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
