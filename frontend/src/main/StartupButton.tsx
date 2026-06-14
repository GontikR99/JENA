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

type LogStatus = 'idle' | 'reading' | 'ready'
type TriggerStatus = 'idle' | 'starting' | 'started'
export type PipState = 'open' | 'closed'

interface StartupButtonProps {
  onPipChange: (state: PipState) => void
}

export function StartupButton({ onPipChange }: StartupButtonProps) {
  const [logStatus, setLogStatus] = useState<LogStatus>('idle')
  const [triggerStatus, setTriggerStatus] = useState<TriggerStatus>('idle')
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)
  const [savedDirectoryHandle, setSavedDirectoryHandle] =
    useState<FileSystemDirectoryHandleLike | null>(null)
  const [isSavedDirectoryLoaded, setIsSavedDirectoryLoaded] = useState(false)
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandleLike | null>(null)

  const hasActiveDirectoryHandle = directoryHandle !== null
  const isReadingLogs = logStatus === 'reading'
  const areTriggersStarted = triggerStatus === 'started'
  const areTriggersStarting = triggerStatus === 'starting'
  const primaryButtonLabel = getPrimaryButtonLabel({
    areTriggersStarted,
    hasActiveDirectoryHandle,
    hasSavedDirectoryHandle: savedDirectoryHandle !== null,
  })
  const canUseStoredDirectoryMenu =
    !hasActiveDirectoryHandle &&
    !isReadingLogs &&
    !areTriggersStarting &&
    !areTriggersStarted &&
    !isChoosingDirectory &&
    isSavedDirectoryLoaded &&
    savedDirectoryHandle !== null
  const isReadLogsDisabled =
    isReadingLogs ||
    isChoosingDirectory ||
    hasActiveDirectoryHandle ||
    !isSavedDirectoryLoaded
  const isStartTriggersDisabled =
    areTriggersStarting || (!areTriggersStarted && !hasActiveDirectoryHandle)
  const isPrimaryButtonDisabled = hasActiveDirectoryHandle
    ? isStartTriggersDisabled
    : isReadLogsDisabled
  const shouldShowStoredDirectoryMenu =
    savedDirectoryHandle !== null && !hasActiveDirectoryHandle

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
      stopTriggers()
      return
    }

    setTriggerStatus('starting')

    try {
      if (!isDocumentPipSupported()) {
        throw new Error(
          'Document Picture-in-Picture is not supported in this browser.',
        )
      }

      await openPipWindow({
        onClose: () => {
          setTriggerStatus('idle')
          onPipChange('closed')
        },
      })

      setTriggerStatus('started')
      onPipChange('open')
    } catch (error) {
      closePipWindow()
      setTriggerStatus('idle')
      onPipChange('closed')
      toast.error(getErrorMessage(error))
    }
  }

  function stopTriggers() {
    closePipWindow()
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
      toast.success('Stored directory forgotten.')
    } catch (error) {
      toast.error(getErrorMessage(error))
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
  hasActiveDirectoryHandle,
  hasSavedDirectoryHandle,
}: {
  areTriggersStarted: boolean
  hasActiveDirectoryHandle: boolean
  hasSavedDirectoryHandle: boolean
}) {
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
