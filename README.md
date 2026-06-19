# JENA

**Most of JENA was written with OpenAI Codex, guided, reviewed, and tested by a human maintainer.** Expect the codebase to reflect an active AI-assisted development process: pragmatic structure, frequent iteration, and a lot of product decisions captured directly in the implementation.

JENA is Jephine's Event Notification Apparatus: a browser-based EverQuest trigger tool inspired by GINA. It reads local EverQuest log files, matches trigger patterns, and displays timers and text alerts in a small Picture-in-Picture window that can sit over the game.

JENA runs in the browser. There is no desktop client to install.

## Getting Started

Open JENA, then choose your EverQuest directory with **Open EverQuest Directory** or **Choose EverQuest Directory**. JENA asks for the EverQuest folder so it can read your local log files.

After the directory is open, click **Start Triggers**. This opens a small runtime window that can be moved over the EverQuest window to show timers and text alerts while you play.

JENA can import GINA Trigger Package files, so existing trigger packages can be used as a starting point.

## Notable Features

- **Web-only trigger runtime**: JENA runs from the browser and stores local data in browser storage.
- **GINA-style trigger import**: Import GINA trigger packages and use them as JENA triggers.
- **Picture-in-Picture alerts**: Timers and text alerts appear in a small always-on-top browser PiP window.
- **Per-character enablement**: Turn triggers on or off per local character.
- **Optional character names**: JENA can add the character name to alerts when the trigger text does not already include it.
- **Publishing**: Logged-in users can publish selected triggers.
- **Subscriptions**: Anyone can subscribe to published triggers with a subscription code. Subscribed triggers stay separate from personal triggers and update when the publisher changes their published set.
- **Broadcasting**: Trigger alerts can be broadcast to your own boxes or to subscribers, useful when one character receives a raid emote, tell, or timer-relevant line that others should know about.
- **Adoption from subscriptions**: Subscribed triggers can be copied into a user's personal trigger tree.

## Publish, Subscribe, And Broadcast

Publishing lets a logged-in user share selected triggers without handing around a new package every time the triggers change.

Subscriptions let other users follow those published triggers. A subscription is added with a code like:

```text
{JENA:sub:...}
```

Subscribed triggers remain separate from personal triggers. They can be enabled, disabled, or left to follow the subscription default on a per-trigger basis.

Broadcasting controls what happens when a trigger matches:

- **Private**: only the client that saw the log line handles the alert.
- **My boxes**: the alert is sent to the publisher's own logged-in clients.
- **My subscribers**: the alert is sent to the publisher's clients and to subscribers.

This is meant for cases like playing multiple characters on different PCs, only one of which has speakers or attention, or raid mechanics where one player receives a message that the group should react to.

## Architecture

JENA has a React/Vite frontend and a Go backend.

The frontend:

- Uses React and TypeScript.
- Talks internally through a typed message bus and RPC layer.
- Uses a Web Worker to watch EverQuest log files and run matcher services.
- Uses browser File System Access APIs to read the selected EverQuest directory.
- Stores local trigger and settings data in IndexedDB.
- Renders the trigger runtime into a Document Picture-in-Picture window.

The backend:

- Is a Go HTTP/WebSocket server.
- Uses SQLite for persistence.
- Provides auth/session, user trigger storage, trigger storage, sharing, subscription, broadcast, and presence services.
- Bridges frontend websocket clients into the backend event bus.
- Uses vendored Go dependencies.

Shared trigger models are kept aligned between the frontend TypeScript types and backend Go model package.

## Development

The top-level Makefile is designed to run on Windows. Several targets call
PowerShell directly for cleanup, copying, and packaging steps. The frontend and
backend can still be run manually on other platforms, but the Makefile should be
treated as Windows-oriented.

Build dependencies:

- Go 1.25.0 or newer. The backend module declares `go 1.25.0`.
- Node.js `^20.19.0`, `^22.12.0`, or `>=24.0.0`. This comes from the frontend
  Vite toolchain in `package-lock.json`.
- npm with lockfile version 3 support. npm 10 or newer is recommended; npm 11 is
  known to work.
- GNU Make. GNU Make 4.4.1 is known to work.

Initial setup from the repository root:

```sh
make init
```

That installs frontend dependencies with `npm ci` and rebuilds the vendored Go
dependencies under `backend/vendor`.

From the repository root:

```sh
make dev
make frontend
make bump-protocol-version
make test
make package
```

Use `make bump-protocol-version` when an incompatible frontend/backend message
or RPC contract change requires old tabs to reload against the new backend.
The target updates `protocol-version.txt` and regenerates checked-in frontend and
backend source files, so raw `npm run build` and `go run` commands still compile
against the current committed protocol version.

Frontend commands:

```sh
cd frontend
npm run dev
npm run build
npm run test
```

Backend commands:

```sh
cd backend
go test -mod=vendor ./...
go run -mod=vendor ./cmd/jena-backend
```

## License

JENA is licensed under the GNU Affero General Public License version 3.0. See [LICENSE](LICENSE).
