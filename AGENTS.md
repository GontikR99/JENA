# JENA Project Guide

## Overview

JENA is a React/Vite frontend with a Go backend for EverQuest log-file driven trigger tooling. The frontend works with an EverQuest installation directory through browser file-system APIs, tails EverQuest log files in a web worker, manages user trigger data, and opens a Document Picture-in-Picture trigger runtime window.

The backend is an HTTP/WebSocket server with a small dependency container, an event bus, SQLite-backed persistence, trigger stores, identity stubs, and worldwide presence services. Backend dependencies are vendored.

The frontend is built with Vite, React 19, TypeScript, Bootstrap, React Bootstrap, `react-hot-toast`, `react-resizable-panels`, `@tanstack/react-virtual`, `@szhsin/react-menu`, `fflate`, `htmlparser2`, `re2js`, and Lucide icons.

## Repository Layout

- `frontend/`: Browser application.
- `frontend/src/main/`: Main browser window entry point, app shell, bridges, trigger runtime, and trigger management UI.
- `frontend/src/main/triggers/`: Trigger editor, GINA import/export, user trigger editor/manager/store, and alert coordination.
- `frontend/src/main/triggers/editor/`: Supporting trigger editor components.
- `frontend/src/pip/`: Components rendered into the Document Picture-in-Picture runtime window.
- `frontend/src/shared/`: Shared browser utilities, typed messages, event bus code, trigger models, widgets, and browser API wrappers.
- `frontend/src/worker/`: Web worker entry point, worker-local event bus, file watcher, matcher service, character presence service, and worker DI.
- `frontend/public/`: Static public frontend assets.
- `backend/`: Go backend server, internal services, model package, vendored dependencies, and backend tests.
- `backend/model/`: Backend JSON models that mirror shared frontend models where needed.
- `docs/`: User-facing documentation such as trigger pattern syntax.
- `example_data/`: Example GINA trigger package/XML data.

## Main Application Flow

The main app is mounted from `frontend/src/main/main.tsx`. It imports Bootstrap and app CSS, then renders `App` under React `StrictMode`.

`frontend/src/main/App.tsx` installs the provider/bridge stack:

- `MessageBrokerProvider`
- `AuthProvider`
- `ServerBridge`
- `WorkerBridge`
- `TriggerStoreProvider`
- `AlertCoordinationService`
- `UserTriggerManagerProvider`
- `NearbyCharactersProvider`
- `TriggerRuntimeProvider`
- `AppShell`
- `TriggerRuntimePortal`
- `ServerConnectionGlass`
- `Toaster`

`frontend/src/main/AppShell.tsx` owns the top navigation shell, login button, startup button slot, and current main section. The active app section is currently `Triggers`.

`frontend/src/main/StartupButton.tsx` owns the EverQuest-directory workflow:

- Load a previously saved EverQuest directory handle from IndexedDB.
- Let the user choose an EverQuest directory with the File System Access API.
- Validate the selected directory by checking for `eqgame.exe`.
- Save, reuse, or forget the chosen directory handle.
- Send the active directory handle to the worker with the `worker.file-watcher.setFileHandle` RPC.
- Start or stop the trigger runtime through `useTriggerRuntime()`.

For current semantics, triggers are considered running if and only if the Document Picture-in-Picture runtime window is open.

## Trigger Runtime And PiP

`frontend/src/main/TriggerRuntime.tsx` provides `TriggerRuntimeProvider`, `useTriggerRuntime()`, and `TriggerRuntimePortal`.

The runtime API exposes:

```ts
const {
  areTriggersRunning,
  canUseTriggerRuntime,
  isStartingTriggers,
  isStoppingTriggers,
  startTriggers,
  stopTriggers,
} = useTriggerRuntime()
```

`TriggerRuntimePortal` renders `frontend/src/pip/pip.tsx` into the PiP document with `createPortal`. This is intentional: React context flows through the portal, so PiP components can use the same providers as the main app.

`frontend/src/shared/documentPipHost.ts` wraps the Document Picture-in-Picture API without creating a React root. It creates the PiP document host element, injects minimal base styles, mirrors main-document `<style>` and stylesheet `<link>` nodes into the PiP document, and observes `document.head` so Vite-injected or component-imported CSS is copied into the PiP window.

When changing PiP behavior, preserve feature detection, user-gesture compatibility for `requestWindow()`, cleanup on `pagehide`, and style mirroring.

## Browser API Wrappers

`frontend/src/shared/fileSystemAccess.ts` wraps the File System Access API. It keeps local TypeScript interfaces for the directory and file handle methods the app uses. The main validation rule is that an EverQuest directory must contain `eqgame.exe`.

`frontend/src/shared/directoryHandleStore.ts` persists the selected directory handle in IndexedDB using database `jena`, object store `handles`, and key `everquest-directory`.

`frontend/src/shared/documentPipHost.ts` wraps the Document Picture-in-Picture host/window mechanics.

Use these wrappers instead of reaching directly for `showDirectoryPicker`, IndexedDB, or `documentPictureInPicture` from UI components.

## Message Bus And RPC

Typed message and RPC contracts are defined in `frontend/src/shared/messages.ts`. Treat this file as the frontend compact IDL. Add endpoint payloads, RPC endpoints, request types, and response types there before wiring new frontend bus or RPC behavior.

The bus uses a routed envelope instead of event-name subscriptions:

```ts
interface BusMessage<TPayload = unknown> {
  authToken?: string
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
const send = useSender('some-component')
send('some.endpoint', { value: 1 })

useListen('server.*', (message) => {
  // Bridge or local listener code.
})

const call = useRpc('startup-button')
await call('worker.file-watcher', 'setFileHandle', { fileHandle })

useRpcServer('some-endpoint', {
  setStatus: async ({ text }) => {
    return { accepted: true }
  },
})
```

`useListen` and `useRpcServer` unregister in React effect cleanup. RPC calls require a non-null source endpoint so responses can route back to the caller.

Client-side endpoint prefixes have transport meaning:

- Client-to-worker messages use destinations such as `worker.file-watcher`; `WorkerBridge` strips `worker.` before posting to the worker.
- Worker-to-client messages can use `client.*`; the worker message bus strips `client.` before posting to the main bus.
- Worker-to-server messages can use `server.*`; the worker message bus forwards those to the main bus for `ServerBridge`.
- Client-to-server messages use `server.*`; `ServerBridge` strips `server.` before sending over the websocket.

Client code should generally listen for unprefixed local destinations such as `matcher.match-found`, not `client.matcher.match-found`.

## Server Bridge

`frontend/src/main/ServerBridge.tsx` connects the frontend bus to the backend websocket. It handles keepalives, reconnect status, message IDs, acknowledgements, deduplication, auth-token attachment, and routing for `server.*` destinations.

`ServerConnectionGlass` disables the app while the server bridge is unavailable.

`frontend/src/main/AuthContext.tsx` currently provides dummy login/logout state and an auth token for `ServerBridge`.

## Worker Bridge And Worker Services

`frontend/src/main/WorkerBridge.tsx` creates the worker from `frontend/src/worker/worker.ts` on demand. It listens for main-bus messages whose destination matches `worker.*`.

Worker services are installed through `frontend/src/worker/di.ts`; `frontend/src/worker/worker.ts` installs `WorkerMessageBus`, worker `MessageBroker`, `FileWatcher`, `MatcherService`, and `CharacterPresenceService`.

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

`frontend/src/worker/FileWatcher.ts` exposes `worker.file-watcher.setFileHandle` and `worker.file-watcher.getCharacters`. Once a valid EverQuest directory handle is set, it scans for log files and tails them. Setting the file handle to `null` stops scanning and tailing.

`FileWatcher` also exposes an observer API for parsed EverQuest log lines:

```ts
const watcher = getDependency(deps, FileWatcher)

const unobserve = watcher.observe({
  onLogLine: (record) => {
    // record has characterName, serverName, timestamp, and text.
  },
})
```

`frontend/src/worker/MatcherService.ts` registers regex patterns by pattern string, batches/recompiles efficiently, and publishes `matcher.match-found` messages containing the matching pattern, log metadata, and captures.

`frontend/src/worker/CharacterPresenceService.ts` listens to file-watcher activity and matcher messages, tracks character activity/zone, broadcasts `character-presence.characters`, and reports worker-side presence to the server through `server.*` bus messages.

## Trigger Model And Trigger Data

Frontend trigger models live in `frontend/src/shared/triggers.ts`. Backend trigger models and canonicalization live under `backend/model/`.

JENA trigger IDs are content-derived hash UUIDs. Frontend code should use `withCanonicalTriggerId()` / `createJenaTriggerId()` before storing triggers; backend stores verify canonical IDs and reject mismatches.

The model includes:

- `JenaTrigger`
- `JenaTriggerMatcher`
- `JenaTimerEarlyEnder`
- `JenaExtendedTrigger`
- `JenaResolvedTrigger`
- enablement changes
- publish/broadcast flag changes

`frontend/src/main/triggers/TriggerStore.tsx` is a write-through trigger cache. It stores canonical trigger objects in IndexedDB, writes novel triggers to the server trigger store, fetches missing triggers by ID, and exposes `useOnNewTrigger()` for services that need to react to any trigger the frontend has handled since startup.

`frontend/src/main/triggers/UserTriggerManager.tsx` manages the resolved trigger list for the current user. Logged-out state is local/IndexedDB-backed; logged-in state syncs with the server user trigger store. It exposes `useTriggerManager()`.

`frontend/src/main/triggers/UserTriggersEditor.tsx` is the trigger tree editor. It supports groups, empty UI-only groups, multi-select, context menus, import/export, add/edit/delete/rename/move, enablement, publish, and broadcast toggles. Double-clicking a trigger opens the trigger editor.

`frontend/src/main/triggers/TriggerEditorDialog.tsx` is the modal trigger editor.

`frontend/src/main/triggers/ginaPackageParser.ts` imports GINA package files (`.gtp`, zip with `ShareData.xml`) into `JenaTrigger` objects. `frontend/src/main/triggers/ginaPackageExporter.ts` exports JENA triggers back to a GINA package-shaped zip.

`docs/patterns.md` documents supported trigger pattern and substitution syntax.

## Alert Coordination

`frontend/src/main/triggers/AlertCoordinationService.tsx` is a headless service mounted under `TriggerStoreProvider`.

It uses `useOnNewTrigger()` to receive every trigger handled by the frontend, compiles the main matcher and timer early enders through `alertPatternCompiler.ts`, registers regexes with `worker.matcher-service.add-patterns`, listens for `matcher.match-found`, performs post-validation for `{C}` and numeric bounds, substitutes display/speech/timer text, logs matches for now, and publishes:

- `alert.trigger-matched`
- `alert.timer-early-ended`

This service intentionally fires even for disabled triggers for now. It is not yet gated by `UserTriggerManager` enablement.

## Backend

The backend module is `backend/` (`module jena/backend`). The entry point is `backend/cmd/jena-backend/main.go`.

The backend uses:

- `internal/app`: simple dependency container.
- `internal/config`: command-line configuration.
- `internal/httpserver`: HTTP server and route registration.
- `internal/eventbus`: backend event bus with RPC semantics compatible with the frontend bus.
- `internal/websocketbridge`: websocket bridge between frontend/server event buses.
- `internal/database`: SQLite database setup using vendored `modernc.org/sqlite`.
- `internal/identityservice`: dummy identity lookup; non-empty auth tokens currently map to `test-user`.
- `internal/triggerstore`: persistent canonical trigger JSON store.
- `internal/usertriggerstore`: per-user trigger records, enablement, publish/broadcast flags, revision/update RPCs, and broadcasts.
- `internal/worldwidepresenceservice`: aggregates character presence across websocket sources and broadcasts nearby characters.

Backend JSON models live in `backend/model`. Keep these aligned with `frontend/src/shared/triggers.ts` and `frontend/src/shared/messages.ts` when changing shared contracts.

Backend dependencies are vendored. Use `make vendor-backend` after backend dependency changes.

## Styling

Global browser styles are in `frontend/src/index.css`.

Main-window layout styles are in `frontend/src/main/main.css` and component-specific CSS under `frontend/src/main/`.

PiP content is rendered through a React portal into a separate document. `documentPipHost.ts` mirrors main-document style/link nodes into the PiP document so Bootstrap, app CSS, widget CSS, and PiP component CSS imports apply inside the PiP window.

## Development Commands

From the repository root:

```sh
make clean
make dev
make frontend
make test
make test-frontend
make test-backend
make vendor-backend
make package
```

From `frontend/`:

```sh
npm run dev
npm run build
npm run lint
npm run test
npm run preview
```

From `backend/`:

```sh
go test -mod=vendor ./...
go run -mod=vendor ./cmd/jena-backend
```

`npm run build` runs TypeScript project build first, then Vite build. `npm run test` runs Vitest once.

Tests live in a `__tests__` directory under the major subcomponent they cover:

- `frontend/src/main/__tests__/`
- `frontend/src/pip/__tests__/`
- `frontend/src/shared/__tests__/`
- `frontend/src/worker/__tests__/`

Backend tests live alongside backend packages as normal Go `_test.go` files.

Use `frontend/src/worker/di.ts`'s `installInstance` helper when a worker test needs to provide a mock or fake dependency before installing the component under test.

## Implementation Notes For Agents

- Keep shared frontend message and RPC payloads type-safe by updating `frontend/src/shared/messages.ts` before wiring new bus or RPC behavior.
- Keep frontend/backend trigger models and canonicalization aligned when changing trigger JSON shape.
- Prefer `MessageBroker` and the React hooks in `shared/messageBrokerHooks.ts` over direct `postMessage` or direct bus access.
- Worker services should be installed through `worker/di.ts` and should obtain `MessageBroker` or other worker services with `getDependency`.
- Backend services should use the backend event bus and container patterns already present under `backend/internal`.
- Use existing browser wrapper modules instead of reaching directly for `showDirectoryPicker`, IndexedDB, or `documentPictureInPicture` from UI components.
- Preserve the separation between main-window UI, PiP UI, shared browser utilities, worker code, and backend services.
- This project uses strict TypeScript options such as `noUnusedLocals`, `noUnusedParameters`, and `erasableSyntaxOnly`; avoid unused imports, enums, namespaces, and parameter properties.
- Use `apply_patch` for manual file edits.
