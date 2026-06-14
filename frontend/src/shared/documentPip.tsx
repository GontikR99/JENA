import { createRoot, type Root } from 'react-dom/client'
import { Pip } from '../pip/pip'

interface DocumentPictureInPictureOptions {
  height?: number
  width?: number
}

interface DocumentPictureInPictureController {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
}

interface WindowWithDocumentPictureInPicture extends Window {
  documentPictureInPicture?: DocumentPictureInPictureController
}

interface OpenPipWindowOptions {
  onClose?: () => void
}

const pipWindowOptions: DocumentPictureInPictureOptions = {
  height: 180,
  width: 320,
}

let pipRoot: Root | null = null
let pipWindow: Window | null = null
let closeListener: (() => void) | null = null

export function isDocumentPipSupported() {
  return typeof getDocumentPictureInPicture()?.requestWindow === 'function'
}

export async function openPipWindow(options: OpenPipWindowOptions = {}) {
  if (pipWindow && !pipWindow.closed) {
    pipWindow.focus()
    return
  }

  const documentPictureInPicture = getDocumentPictureInPicture()

  if (!documentPictureInPicture) {
    throw new Error('Document Picture-in-Picture is not supported in this browser.')
  }

  const nextPipWindow =
    await documentPictureInPicture.requestWindow(pipWindowOptions)

  pipWindow = nextPipWindow
  closeListener = options.onClose ?? null
  renderPip(nextPipWindow)

  nextPipWindow.addEventListener('pagehide', cleanupPipWindow, { once: true })
}

export function closePipWindow() {
  const currentPipWindow = pipWindow

  cleanupPipWindow()

  if (currentPipWindow && !currentPipWindow.closed) {
    currentPipWindow.close()
  }
}

function renderPip(targetWindow: Window) {
  const targetDocument = targetWindow.document

  targetDocument.title = 'JENA'
  targetDocument.body.innerHTML = ''
  targetDocument.head.innerHTML = ''

  const styleElement = targetDocument.createElement('style')
  styleElement.textContent = `
    :root {
      background: #fff;
      color: #101828;
      font: 16px/1.5 system-ui, 'Segoe UI', Roboto, sans-serif;
    }

    body {
      margin: 0;
    }

    .pip-view {
      align-items: center;
      box-sizing: border-box;
      display: flex;
      min-height: 100vh;
      justify-content: center;
      padding: 16px;
    }
  `

  const rootElement = targetDocument.createElement('div')
  rootElement.id = 'pip-root'

  targetDocument.head.append(styleElement)
  targetDocument.body.append(rootElement)

  pipRoot = createRoot(rootElement)
  pipRoot.render(<Pip />)
}

function cleanupPipWindow() {
  const currentCloseListener = closeListener

  pipRoot?.unmount()
  pipRoot = null
  pipWindow = null
  closeListener = null

  currentCloseListener?.()
}

function getDocumentPictureInPicture() {
  return (window as WindowWithDocumentPictureInPicture)
    .documentPictureInPicture
}
