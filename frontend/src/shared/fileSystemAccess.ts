export interface FileSystemHandleLike {
  kind: 'file' | 'directory'
  name: string
}

export interface FileSystemFileHandleLike extends FileSystemHandleLike {
  kind: 'file'
}

export interface FileSystemDirectoryHandleLike extends FileSystemHandleLike {
  kind: 'directory'
  getFileHandle(name: string): Promise<FileSystemFileHandleLike>
  queryPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
}

interface FileSystemPermissionDescriptor {
  mode: 'read'
}

interface ShowDirectoryPickerOptions {
  id?: string
  mode: 'read'
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: (
    options?: ShowDirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandleLike>
}

const readPermissionDescriptor: FileSystemPermissionDescriptor = { mode: 'read' }

export function isDirectoryPickerSupported() {
  return typeof getDirectoryPicker() === 'function'
}

export async function pickEverQuestDirectory() {
  const showDirectoryPicker = getDirectoryPicker()

  if (!showDirectoryPicker) {
    throw new Error('Directory selection is not supported in this browser.')
  }

  return showDirectoryPicker({
    id: 'everquest-directory',
    mode: 'read',
  })
}

export async function requestReadPermission(
  directoryHandle: FileSystemDirectoryHandleLike,
) {
  return directoryHandle
    .requestPermission(readPermissionDescriptor)
    .then((requestedPermission) => requestedPermission === 'granted')
}

export async function validateEverQuestDirectory(
  directoryHandle: FileSystemDirectoryHandleLike,
) {
  try {
    await directoryHandle.getFileHandle('eqgame.exe')
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return false
    }

    throw error
  }
}

function getDirectoryPicker() {
  return (window as WindowWithDirectoryPicker).showDirectoryPicker
}
