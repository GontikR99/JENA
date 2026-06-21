import { app, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import path from 'node:path'
import type { Disposable } from '../di'

export class TrayService implements Disposable {
  private tray: Tray | null = null

  start() {
    const icon = loadTrayIcon()
    this.tray = new Tray(icon)
    this.tray.setToolTip('JENA Companion')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          click: () => {
            void shell.openExternal('https://jena.tools/')
          },
          label: 'Launch JENA',
        },
        {
          click: () => {
            void dialog.showMessageBox({
              buttons: ['OK'],
              message: 'JENA Companion',
              detail:
                'JENA Companion is an optional local helper for JENA. This version enables reliable clipboard actions from trigger alerts.',
              type: 'info',
            })
          },
          label: 'About...',
        },
        {
          type: 'separator',
        },
        {
          click: () => {
            app.quit()
          },
          label: 'Close...',
        },
      ]),
    )
  }

  dispose() {
    this.tray?.destroy()
    this.tray = null
  }
}

function loadTrayIcon() {
  const packagedPath = path.join(process.resourcesPath, 'tray.png')
  const developmentPath = path.join(
    __dirname,
    '..',
    '..',
    'generated',
    'tray.png',
  )
  const image = nativeImage.createFromPath(
    app.isPackaged ? packagedPath : developmentPath,
  )

  if (image.isEmpty()) {
    return nativeImage.createEmpty()
  }

  return image.resize({
    height: 16,
    width: 16,
  })
}
