# JENA Project Guide

## Overview

JENA is currently a browser-based React application for working with an EverQuest installation directory and starting a small Document Picture-in-Picture trigger window. The active code lives in `frontend`; `backend` exists as a placeholder and does not currently contain implementation files.

The frontend is built with Vite, React 19, TypeScript, Bootstrap, React Bootstrap, and `react-hot-toast`.

## Repository Layout

- `frontend/`: The active application.
- `frontend/src/main/`: Main browser window entry point and startup workflow.
- `frontend/src/pip/`: Components rendered inside the Document Picture-in-Picture window.
- `frontend/src/shared/`: Shared browser utilities, typed messages, event bus code, and browser API wrappers.
- `frontend/src/worker/`: Web worker entry point, worker-local event bus, and simple dependency registration helpers.
- `frontend/public/`: Static public assets.
- `backend/`: Reserved for future backend work; currently empty.

## Main Application Flow

The main app is mounted from `frontend/src/main/main.tsx`. It imports Bootstrap and app CSS, then renders `App` under React `StrictMode`.

`frontend/src/main/App.tsx` installs the shared `MessageBrokerProvider`, mounts `WorkerBridge`, renders `StartupButton`, and configures toast notifications.

`frontend/src/main/StartupButton.tsx` owns the current user workflow:

- Load a previously saved EverQuest directory handle from IndexedDB.
- Let the user choose an EverQuest directory with the File System Access API.
- Validate the selected directory by checking for `eqgame.exe`.
- Save, reuse, or forget the chosen directory handle.
- Send the active directory handle to the worker with the `worker.file-watcher.setFileHandle` RPC.
- Start or stop worker-side file watching with `worker.file-watcher.startWatch` and `worker.file-watcher.stopWatch`.
- Open or close the Document Picture-in-Picture trigger window.

## Browser API Wrappers

`frontend/src/shared/fileSystemAccess.ts` wraps the File System Access API. It keeps local TypeScript interfaces for the directory and file handle methods the app uses. The main validation rule is that an EverQuest directory must contain `eqgame.exe`.

`frontend/src/shared/directoryHandleStore.ts` persists the selected directory handle in IndexedDB using database `jena`, object store `handles`, and key `everquest-directory`.

`frontend/src/shared/documentPip.tsx` wraps the Document Picture-in-Picture API. It opens a 320x180 PiP window, injects the PiP document styles, renders the `Pip` React tree into that separate document, and cleans up the React root when the PiP page hides or closes.

When changing these modules, preserve feature detection and permission checks. These APIs are browser-specific and may be unsupported depending on the user's browser.

## Message Bus And RPC

Typed message and RPC contracts are defined in `frontend/src/shared/messages.ts`. Treat this file as the project's compact IDL. Add endpoint payloads, RPC endpoints, request types, and response types there before wiring new behavior.

The bus uses a routed envelope instead of event-name subscriptions:

```ts
interface BusMessage<TPayload = unknown> {
  id: string
  source: string | null
  destination: string
  correlationId?: string
  payload: TPayload
}
```

`frontend/src/shared/messageBroker.ts` implements:

- `MessageBus`: local destination-glob dispatch.
- `MessageBroker`: higher-level `listen`, `send`, `call`, and `register` APIs.
- RPC correlation, timeouts, structured error replies, and async handler invocation.

React uses `frontend/src/shared/messageBrokerHooks.ts`:

```ts
const send = useSender('client.some-component')
send('some.endpoint', { value: 1 })

useListen('server.*', (message) => {
  // Bridge or local listener code.
})

const call = useRpc('client.startup-button')
await call('worker.file-watcher', 'startWatch', {})

useRpcServer('client.pip', {
  setStatus: async ({ text }) => {
    return { accepted: true }
  },
})
```

`useListen` and `useRpcServer` unregister in React effect cleanup. RPC calls require a non-null source endpoint so responses can route back to the caller.

The current worker RPC endpoint is `worker.file-watcher`:

```ts
await call('worker.file-watcher', 'setFileHandle', { fileHandle })
await call('worker.file-watcher', 'enumerateLogs', {})
await call('worker.file-watcher', 'startWatch', {})
await call('worker.file-watcher', 'stopWatch', {})
```

On the worker side, endpoint names are local to the worker. The worker registers `file-watcher`; the main window calls it as `worker.file-watcher`.

Worker DI usage:

```ts
export class SomeWorkerService {
  private readonly unregister: () => void

  constructor(deps: Deps) {
    const broker = getDependency(deps, MessageBroker)

    this.unregister = broker.register('some-endpoint', {
      doThing: this.doThing,
    })
  }

  dispose() {
    this.unregister()
  }

  private readonly doThing = async (params: unknown) => {
    return {}
  }
}
```

`frontend/src/worker/FileWatcher.ts` also exposes an observer API for parsed EverQuest log lines:

```ts
const watcher = getDependency(deps, FileWatcher)

const unobserve = watcher.observe({
  onLogLine: (record) => {
    // record has characterName, serverName, timestamp, and text.
  },
})
```

## PiP And Worker Bridge

`frontend/src/pip/pip.tsx` renders the PiP UI. It currently contains placeholder text.

`frontend/src/main/WorkerBridge.tsx` creates the worker from `frontend/src/worker/worker.ts` on demand. It listens only for client bus messages whose destination matches `worker.*`.

Client-to-worker routing rules:

- Client code sends to destinations such as `worker.file-watcher`.
- `WorkerBridge` strips the `worker.` prefix before posting to the worker.
- If the worker cannot start and the message is an RPC request, `WorkerBridge` responds with a structured RPC error so callers do not hang.

Worker-to-client routing rules:

- Worker code sends from local sources such as `file-watcher`.
- `WorkerBridge` prepends `worker.` to worker message sources before dispatching onto the main bus.
- Messages from the worker whose source already starts with `worker.` are dropped to avoid double-prefixing and routing loops.

`frontend/src/worker/MessageBus.ts` is the worker-side bus. It receives `BusMessage` envelopes from the main thread and posts worker-originated `BusMessage` envelopes back through `self.postMessage`.

`frontend/src/worker/di.ts` provides a minimal class-based dependency map. `frontend/src/worker/worker.ts` creates the dependency map and installs `WorkerMessageBus`, worker `MessageBroker`, and `FileWatcher`.

## Styling

Global browser styles are in `frontend/src/index.css`.

Main-window layout styles are in `frontend/src/main/main.css`.

PiP styles are currently injected directly by `renderPip` in `frontend/src/shared/documentPip.tsx`, because the PiP window has its own document.

## Development Commands

Run commands from `frontend/`:

```sh
npm run dev
npm run build
npm run lint
npm run preview
```

`npm run build` runs TypeScript project build first, then Vite build. There is no test script configured at this time.

## Implementation Notes For Agents

- Prefer editing the active frontend code under `frontend/src`.
- Keep shared message and RPC payloads type-safe by updating `shared/messages.ts` before wiring new bus or RPC behavior.
- Prefer `MessageBroker` and the React hooks in `shared/messageBrokerHooks.ts` over direct `postMessage` or direct bus access.
- Worker services should be installed through `worker/di.ts` and should obtain `MessageBroker` or other worker services with `getDependency`.
- Use the existing browser wrapper modules instead of reaching directly for `showDirectoryPicker`, IndexedDB, or `documentPictureInPicture` from UI components.
- Preserve the separation between main-window UI, PiP UI, shared browser utilities, and worker code.
- Treat `backend/` as unused unless the requested task explicitly adds backend functionality.
- This project uses strict TypeScript options such as `noUnusedLocals`, `noUnusedParameters`, and `erasableSyntaxOnly`; avoid unused imports, enums, namespaces, and parameter properties.
