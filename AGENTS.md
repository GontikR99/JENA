# JENA Project Guide

## Overview

JENA is a React/Vite frontend with a Go backend for EverQuest log-file driven trigger tooling. The frontend works with an EverQuest installation directory through browser file-system APIs, tails EverQuest log files in a web worker, manages user trigger data, and opens a Document Picture-in-Picture trigger runtime window.

The backend is an HTTP/WebSocket server with a small dependency container, an event bus, SQLite-backed persistence, trigger stores, identity stubs, and worldwide presence services. Backend dependencies are vendored.

The frontend is built with Vite, React 19, TypeScript, Bootstrap, React Bootstrap, `react-hot-toast`, `react-resizable-panels`, `@tanstack/react-virtual`, `@szhsin/react-menu`, `fflate`, `htmlparser2`, `re2js`, and Lucide icons.

## Repository Layout

- `frontend/`: Browser application.
- `frontend/src/main.tsx`: Browser entry point.
- `frontend/src/App.tsx`: Top-level provider and bridge stack.
- `frontend/src/AppShell.tsx`: Main navigation shell, startup button slot, login button, and current app section.
- `frontend/src/auth/`: Dummy auth context.
- `frontend/src/assets/`: Frontend image assets such as the JENA lockup and character activity indicators.
- `frontend/src/bridges/server/`: Browser websocket bridge to the Go backend.
- `frontend/src/bridges/worker/`: Browser-to-worker bridge.
- `frontend/src/characters/`: Local and nearby character presence providers.
- `frontend/src/pip/`: Components rendered into the Document Picture-in-Picture runtime window.
- `frontend/src/runtime/`: Trigger runtime and EverQuest-directory startup workflow.
- `frontend/src/shared/`: Shared browser utilities, typed messages, message broker code, trigger models, widgets, and browser API wrappers.
- `frontend/src/triggers/`: Trigger editor, GINA import/export, user trigger editor/manager/store, alert coordination, trigger views, and trigger model helpers.
- `frontend/src/triggers/alerts/`: Alert pattern compilation, trigger match coordination, speech service, and alert hooks.
- `frontend/src/triggers/editor/`: Supporting trigger editor components.
- `frontend/src/triggers/gina/`: GINA package import/export code.
- `frontend/src/triggers/model/`: Trigger store and user trigger manager.
- `frontend/src/triggers/views/`: Trigger workspace UI, trigger tree editor, character pane, and trigger log table.
- `frontend/src/worker/`: Web worker entry point, worker-local event bus, file watcher, matcher service, character presence service, and worker DI.
- `frontend/public/`: Static public frontend assets.
- `backend/`: Go backend server, internal services, model package, vendored dependencies, and backend tests.
- `backend/model/`: Backend JSON trigger models and canonicalization aligned with frontend trigger models.
- `docs/`: User-facing documentation such as trigger pattern syntax.
- `example_data/`: Example GINA trigger package/XML data.

## Main Application Flow

The main app is mounted from `frontend/src/main.tsx`. It imports Bootstrap, `frontend/src/index.css`, `frontend/src/main.css`, and renders `App` under React `StrictMode`.

`frontend/src/App.tsx` installs the provider/bridge stack:

- `MessageBrokerProvider`
- `AuthProvider`
- `ServerBridge`
- `WorkerBridge`
- `TriggerStoreProvider`
- `AlertCoordinationService`
- `UserTriggerManagerProvider`
- `NearbyCharactersProvider`
- `LocalCharactersProvider`
- `TriggerRuntimeProvider`
- `TriggerSpeechService`
- `AppShell`
- `TriggerRuntimePortal`
- `ServerConnectionGlass`
- `Toaster`

`frontend/src/AppShell.tsx` owns the top navigation shell, login button, startup button slot, and current main section. The active app section is currently `Triggers`; `Rolls` and `Search` are present but disabled.

`frontend/src/runtime/StartupButton.tsx` owns the EverQuest-directory workflow:

- Load a previously saved EverQuest directory handle from IndexedDB.
- Let the user choose an EverQuest directory with the File System Access API.
- Validate the selected directory by checking for `eqgame.exe`.
- Save, reuse, or forget the chosen directory handle.
- Send the active directory handle to the worker with the `worker.file-watcher.setFileHandle` RPC.
- Start or stop the trigger runtime through `useTriggerRuntime()`.

For current semantics, triggers are considered running if and only if the Document Picture-in-Picture runtime window is open.

## Trigger Runtime And PiP

`frontend/src/runtime/TriggerRuntime.tsx` provides `TriggerRuntimeProvider`, `useTriggerRuntime()`, and `TriggerRuntimePortal`.

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

`TriggerRuntimePortal` renders `frontend/src/pip/pip.tsx` into the PiP document with `createPortal`. This is intentional: React context flows through the portal, so PiP components can use the same providers as the main app. The current PiP content is minimal and should be treated as unfinished runtime UI.

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
- Worker-to-client messages use `client.*`; `WorkerMessageBus` strips `client.` before posting to the main bus, so main-window listeners use unprefixed destinations such as `matcher.match-found`.
- Worker-to-server messages use `server.*`; `WorkerMessageBus` posts these to the main bus for `ServerBridge`.
- Client-to-server messages use `server.*`; `ServerBridge` strips `server.` before sending over the websocket.
- Backend websocket sources are internally expanded to `ws.<connection>.<source>` by `backend/internal/websocketbridge/bridge.go`; replies and broadcasts to a specific browser are sent to `ws.<connection>.<topic>` and stripped again before reaching the browser.

Client code should generally listen for unprefixed local destinations such as `matcher.match-found`, not `client.matcher.match-found`.

## Endpoint And Topic Catalog

The canonical typed frontend contract is `frontend/src/shared/messages.ts`. Worker implementations register unprefixed endpoints inside the worker because `WorkerBridge` strips `worker.`. Backend implementations register unprefixed endpoints because `ServerBridge` strips `server.`.

### Message Topics

| Topic | Contract source | Producer source | Consumer source | Purpose |
| --- | --- | --- | --- | --- |
| `alert.timer-early-ended` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `frontend/src/triggers/alerts/AlertCoordinationService.tsx` | `frontend/src/triggers/alerts/useTriggerAlerts.ts` | Announces that a timer early-ender pattern matched a log line. |
| `alert.trigger-matched` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `frontend/src/triggers/alerts/AlertCoordinationService.tsx` | `frontend/src/triggers/alerts/useTriggerAlerts.ts`, `frontend/src/triggers/alerts/TriggerSpeechService.tsx` | Announces a trigger match with substituted display, speech, and timer text. |
| `character-presence.characters` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `frontend/src/worker/CharacterPresenceService.ts` as `client.character-presence.characters` | `frontend/src/characters/LocalCharactersProvider.tsx`, `frontend/src/triggers/editor/TriggerEditorDialog.tsx` | Publishes local characters, active state, and zone information to the main window. |
| `file-watcher.characters` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `frontend/src/worker/FileWatcher.ts` | `frontend/src/worker/CharacterPresenceService.ts` | Worker-local list of characters discovered from EverQuest log files and their active state. |
| `matcher.match-found` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `frontend/src/worker/MatcherService.ts` as `client.matcher.match-found` | `frontend/src/triggers/alerts/AlertCoordinationService.tsx`; worker-local `client.matcher.match-found` is consumed by `frontend/src/worker/CharacterPresenceService.ts` | Publishes regex match results with captures and log metadata. |
| `speech.preview-requested` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `frontend/src/triggers/editor/TriggerEditorDialog.tsx` | `frontend/src/triggers/alerts/TriggerSpeechService.tsx` | Requests speech synthesis preview from the trigger editor. |
| `trigger-store.triggers-seen` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `frontend/src/triggers/model/TriggerStore.tsx` | `frontend/src/triggers/alerts/AlertCoordinationService.tsx` | Announces newly handled canonical triggers so alert patterns can be registered. |
| `user-trigger-store.updated` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `backend/internal/usertriggerstore/service.go` | `frontend/src/triggers/model/UserTriggerManager.tsx` | Broadcasts per-user trigger updates to active browser sessions for the same user. |
| `worldwide-presence.nearby-characters` | `frontend/src/shared/messages.ts` (`EndpointMessages`) | `backend/internal/worldwidepresenceservice/service.go` | `frontend/src/characters/NearbyCharactersProvider.tsx` | Sends nearby characters in zones touched by the current websocket source. |
| `server.character-presence.characters` | Transported worker-to-server topic; payload type is `CharacterPresenceCharactersMessage` in `frontend/src/shared/messages.ts` | `frontend/src/worker/CharacterPresenceService.ts` | `backend/internal/worldwidepresenceservice/service.go` after prefix stripping | Reports this browser's local character presence to the backend. |

### RPC Endpoints

| Public RPC endpoint | Contract source | Registered implementation | Methods | Purpose |
| --- | --- | --- | --- | --- |
| `worker.file-watcher` | `frontend/src/shared/messages.ts` (`RpcEndpoints`) | `frontend/src/worker/FileWatcher.ts` registers `file-watcher` | `setFileHandle`, `getCharacters` | Sets or clears the EverQuest directory handle and reports discovered log-file characters. |
| `worker.matcher-service` | `frontend/src/shared/messages.ts` (`RpcEndpoints`) | `frontend/src/worker/MatcherService.ts` registers `matcher-service` | `add-patterns`, `flush` | Registers regex patterns, compiles them in batches, and optionally flushes pending compilation. |
| `worker.character-presence` | `frontend/src/shared/messages.ts` (`RpcEndpoints`) | `frontend/src/worker/CharacterPresenceService.ts` registers `character-presence` | `getCharacters` | Returns the worker's current character presence snapshot. |
| `server.trigger-store` | `frontend/src/shared/messages.ts` (`RpcEndpoints`) | `backend/internal/triggerstore/service.go` registers `trigger-store` | `storeTriggers`, `fetchTriggers` | Stores canonical trigger JSON and fetches triggers by canonical ID. |
| `server.user-trigger-store` | `frontend/src/shared/messages.ts` (`RpcEndpoints`) | `backend/internal/usertriggerstore/service.go` registers `user-trigger-store` | `upsertTriggers`, `deleteTriggers`, `toggleTriggers`, `setTriggerFlags`, `fetchTriggers`, `ping` | Manages per-user trigger records, enablement, publish/broadcast flags, revisions, and update polling. |

### HTTP And WebSocket Endpoints

| Endpoint | Source file | Purpose |
| --- | --- | --- |
| `GET /_jena/health` | `backend/cmd/jena-backend/main.go` | Backend health check that returns `204 No Content`. |
| `/_jena/ws` by default, configurable with `-websocket-path` | `backend/cmd/jena-backend/main.go`, `backend/internal/config/config.go`, `backend/internal/websocketbridge/bridge.go` | Browser/backend event bus websocket. |
| `/` static app routes | `backend/internal/httpserver/server.go`, `backend/internal/staticfiles/static.go` | Serves frontend assets embedded into the Go binary. |

## Server Bridge

`frontend/src/bridges/server/ServerBridge.tsx` connects the frontend bus to the backend websocket. It handles keepalives, reconnect status, message IDs, acknowledgements, deduplication, auth-token attachment, and routing for `server.*` destinations.

`ServerConnectionGlass` disables the app while the server bridge is unavailable.

`frontend/src/auth/AuthContext.tsx` currently provides dummy login/logout state and an auth token for `ServerBridge`.

## Worker Bridge And Worker Services

`frontend/src/bridges/worker/WorkerBridge.tsx` creates the worker from `frontend/src/worker/worker.ts` on demand. It listens for main-bus messages whose destination matches `worker.*`.

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

`frontend/src/worker/CharacterPresenceService.ts` listens to file-watcher activity and matcher messages, tracks character activity/zone, broadcasts `character-presence.characters`, and reports worker-side presence to the server through `server.character-presence.characters`.

## Character Presence

`frontend/src/characters/LocalCharactersProvider.tsx` loads and listens for local worker character presence.

`frontend/src/characters/NearbyCharactersProvider.tsx` listens for backend `worldwide-presence.nearby-characters` messages and maintains a nearby-character snapshot grouped by zone.

The worker presence service registers matcher patterns for zone entry and `/who` zone output. The backend worldwide presence service treats inactive characters or characters with empty zones as presence removals.

## Trigger Model And Trigger Data

Frontend trigger models live in `frontend/src/shared/triggers.ts`. Backend trigger models and canonicalization live under `backend/model/`.

JENA trigger IDs are content-derived hash UUIDs. Frontend code should use `withCanonicalTriggerId()` / `createJenaTriggerId()` before storing triggers; backend stores verify canonical IDs and reject mismatches.

The model includes:

- `JenaTrigger`
- `JenaTriggerMatcher`
- `JenaTimerEarlyEnder`
- `JenaTriggerActions`
- `JenaTriggerTimer`
- `JenaExtendedTrigger`
- `JenaResolvedTrigger`
- enablement changes
- publish/broadcast flag changes

`frontend/src/triggers/model/TriggerStore.tsx` is a write-through trigger cache. It stores canonical trigger objects in IndexedDB, writes novel triggers to the server trigger store, fetches missing triggers by ID, and publishes `trigger-store.triggers-seen` for services that need to react to any trigger the frontend has handled since startup.

`frontend/src/triggers/model/UserTriggerManager.tsx` manages the resolved trigger list for the current user. Logged-out state is local/IndexedDB-backed; logged-in state syncs with the server user trigger store and polls revision state with `server.user-trigger-store.ping`. It exposes `useTriggerManager()`.

`frontend/src/triggers/views/UserTriggersEditor.tsx` is the trigger tree editor. It supports groups, empty UI-only groups, multi-select, context menus, import/export, add/edit/delete/rename/move, enablement, publish, and broadcast toggles. Double-clicking a trigger opens the trigger editor.

`frontend/src/triggers/editor/TriggerEditorDialog.tsx` is the modal trigger editor.

`frontend/src/triggers/gina/ginaPackageParser.ts` imports GINA package files (`.gtp`, zip with `ShareData.xml`) into `JenaTrigger` objects. `frontend/src/triggers/gina/ginaPackageExporter.ts` exports JENA triggers back to a GINA package-shaped zip.

`docs/patterns.md` documents supported trigger pattern and substitution syntax.

## Alert Coordination

`frontend/src/triggers/alerts/AlertCoordinationService.tsx` is a headless service mounted under `TriggerStoreProvider`.

It listens for `trigger-store.triggers-seen`, compiles the main matcher and timer early enders through `alertPatternCompiler.ts`, registers regexes with `worker.matcher-service.add-patterns`, listens for `matcher.match-found`, performs post-validation for supported pattern syntax, substitutes display/speech/timer text, logs matches for now, and publishes:

- `alert.trigger-matched`
- `alert.timer-early-ended`

`frontend/src/triggers/alerts/useTriggerAlerts.ts` gates trigger-match callbacks on the PiP runtime being open and on the trigger being enabled for the matched character. Timer early-ender callbacks are currently not gated there.

`frontend/src/triggers/alerts/TriggerSpeechService.tsx` speaks trigger match speech text only while triggers are running, and also handles editor speech preview requests regardless of runtime state.

## Backend

The backend module is `backend/` (`module jena/backend`). The entry point is `backend/cmd/jena-backend/main.go`.

The backend uses:

- `internal/app`: simple dependency container.
- `internal/config`: command-line configuration.
- `internal/httpserver`: HTTP server and route registration.
- `internal/staticfiles`: embedded frontend assets served by the backend binary.
- `internal/eventbus`: backend event bus with RPC semantics compatible with the frontend bus.
- `internal/websocketbridge`: websocket bridge between frontend/server event buses.
- `internal/database`: SQLite database setup using vendored `modernc.org/sqlite`, WAL mode, busy timeout, and retry handling for busy/locked database errors.
- `internal/identityservice`: dummy identity lookup; non-empty auth tokens currently map to `test-user`.
- `internal/triggerstore`: persistent canonical trigger JSON store.
- `internal/usertriggerstore`: per-user trigger records, enablement, publish/broadcast flags, revision/update RPCs, and broadcasts.
- `internal/worldwidepresenceservice`: aggregates character presence across websocket sources and broadcasts nearby characters.

Backend JSON models live in `backend/model`. Keep these aligned with `frontend/src/shared/triggers.ts` and `frontend/src/shared/messages.ts` when changing shared contracts.

Backend dependencies are vendored. Use `make vendor-backend` after backend dependency changes.

## Styling

Global browser styles are in `frontend/src/index.css`.

Main-window layout styles are in `frontend/src/main.css`, `frontend/src/AppShell.css`, and component-specific CSS under feature folders such as `frontend/src/triggers/views/` and `frontend/src/triggers/editor/`.

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

`make dev` runs the backend server. `make frontend` runs the Vite dev server. `npm run build` runs TypeScript project build first, then Vite build. `npm run test` runs Vitest once.

Tests live in a `__tests__` directory under the major frontend subcomponent they cover:

- `frontend/src/bridges/server/__tests__/`
- `frontend/src/bridges/worker/__tests__/`
- `frontend/src/characters/__tests__/`
- `frontend/src/shared/__tests__/`
- `frontend/src/triggers/__tests__/`
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
- Preserve the separation between app shell, PiP UI, shared browser utilities, worker code, feature UI, and backend services.
- This project uses strict TypeScript options such as `noUnusedLocals`, `noUnusedParameters`, and `erasableSyntaxOnly`; avoid unused imports, enums, namespaces, and parameter properties.
- Use `apply_patch` for manual file edits.
