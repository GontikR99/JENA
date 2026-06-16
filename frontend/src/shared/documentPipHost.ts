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

export interface DocumentPipHost {
  close: () => void
  container: HTMLElement
  window: Window
}

export interface CreateDocumentPipHostOptions {
  height: number
  onClose: () => void
  title: string
  width: number
}

const mirroredStyleAttribute = 'data-jena-pip-mirrored-style'
const pipRootId = 'pip-root'

export function isDocumentPipSupported() {
  return typeof getDocumentPictureInPicture()?.requestWindow === 'function'
}

export async function createDocumentPipHost({
  height,
  onClose,
  title,
  width,
}: CreateDocumentPipHostOptions): Promise<DocumentPipHost> {
  const documentPictureInPicture = getDocumentPictureInPicture()

  if (!documentPictureInPicture) {
    throw new Error('Document Picture-in-Picture is not supported in this browser.')
  }

  const pipWindow = await documentPictureInPicture.requestWindow({
    height,
    width,
  })
  const pipDocument = pipWindow.document

  pipDocument.title = title
  pipDocument.body.innerHTML = ''
  pipDocument.head.innerHTML = ''

  const container = pipDocument.createElement('div')
  container.id = pipRootId

  pipDocument.head.append(createBaseStyleElement(pipDocument))
  pipDocument.body.append(container)

  const stopMirroringStyles = mirrorDocumentStyles(document, pipDocument)
  let isCleanedUp = false

  const cleanup = () => {
    if (isCleanedUp) {
      return
    }

    isCleanedUp = true
    stopMirroringStyles()
    onClose()
  }

  pipWindow.addEventListener('pagehide', cleanup, { once: true })

  return {
    close: () => {
      cleanup()

      if (!pipWindow.closed) {
        pipWindow.close()
      }
    },
    container,
    window: pipWindow,
  }
}

export function mirrorDocumentStyles(source: Document, target: Document) {
  function syncStyles() {
    target.head
      .querySelectorAll(`[${mirroredStyleAttribute}]`)
      .forEach((node) => {
        node.remove()
      })

    source.head
      .querySelectorAll('style, link[rel="stylesheet"]')
      .forEach((node) => {
        const clone = node.cloneNode(true) as HTMLElement

        clone.setAttribute(mirroredStyleAttribute, 'true')
        target.head.append(clone)
      })
  }

  syncStyles()

  const observer = new MutationObserver(syncStyles)
  observer.observe(source.head, {
    characterData: true,
    childList: true,
    subtree: true,
  })

  return () => {
    observer.disconnect()
  }
}

function createBaseStyleElement(targetDocument: Document) {
  const styleElement = targetDocument.createElement('style')

  styleElement.textContent = `
    html,
    body,
    #${pipRootId} {
      height: 100%;
      margin: 0;
      width: 100%;
    }

    body {
      overflow: hidden;
    }
  `

  return styleElement
}

function getDocumentPictureInPicture() {
  return (window as WindowWithDocumentPictureInPicture)
    .documentPictureInPicture
}
