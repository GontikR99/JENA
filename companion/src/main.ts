import squirrelStartup from 'electron-squirrel-startup'
import { app } from 'electron'
import { MessageBroker, MessageBus } from './bus/messageBroker'
import { ClipboardService } from './services/ClipboardService'
import { CompanionWebSocketServer } from './services/CompanionWebSocketServer'
import { StatusService } from './services/StatusService'
import { TrayService } from './services/TrayService'
import { Container, type Disposable } from './di'

if (squirrelStartup) {
  app.quit()
}

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
}

const disposables: Disposable[] = []

app.on('before-quit', () => {
  while (disposables.length > 0) {
    disposables.pop()?.dispose()
  }
})

void app.whenReady().then(() => {
  app.setName('JENA Companion')
  enableAutoLaunch()

  const container = new Container()
  const bus = new MessageBus()
  const broker = new MessageBroker(bus)
  const clipboardService = new ClipboardService(broker)
  const statusService = new StatusService(broker)
  const websocketServer = new CompanionWebSocketServer(broker)
  const trayService = new TrayService()

  container.install(MessageBus, bus)
  container.install(MessageBroker, broker)
  container.install(ClipboardService, clipboardService)
  container.install(StatusService, statusService)
  container.install(CompanionWebSocketServer, websocketServer)
  container.install(TrayService, trayService)

  disposables.push(trayService, websocketServer, statusService, clipboardService)

  container.get(TrayService).start()
  container.get(CompanionWebSocketServer).start()
})

function enableAutoLaunch() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
    })
    console.log('[JENA Companion] auto-launch at login enabled')
  } catch (error) {
    console.warn('[JENA Companion] unable to enable auto-launch at login', error)
  }
}
