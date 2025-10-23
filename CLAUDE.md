# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Mineflare is a Cloudflare-based Minecraft server hosting platform that combines Cloudflare Workers, Durable Object-backed Containers, and R2 storage to run a full Paper Minecraft server with real-time monitoring, authentication, plugin management, and automated backups.

### Purpose
- Allow users to start and stop their Minecraft server
- View information about their Minecraft server (status, players, version, plugins)
- Issue RCON commands to manage the server, run commands, and administer users
- Use the terminal to access Claude Code AI to manage the server, including creating plugins and changing server properties/configuration

## Commands

### Development
- `bun run dev` - Run the full Alchemy dev workflow: compiles container binaries (HTTP proxy, file server, ttyd), starts the worker, and launches the Vite SPA on http://localhost:5173.
- `bun run dev:spa` - Start only the Vite development server for the frontend.
- `bun run build` - Compile container helper binaries (`bun ./docker_src/build.ts`) and TypeScript worker code (`bun run build:worker`).
- `bun run build:worker` - Compile only the TypeScript worker (no container binaries).

### Deployment
- `bun run deploy` - Deploy to Cloudflare (expects `.env` with credentials; runs with `NODE_ENV=production`).
- `bun run destroy` - Destroy Cloudflare resources created by Alchemy.

### Configuration
- `bun run configure` - Configure Alchemy project parameters.
- `bun run login` - Authenticate Alchemy against Cloudflare.
- `bun run version` - Output the current Alchemy CLI version.

### Container
- `./docker_src/build-container-services.sh` - Manually rebuild the Bun-based HTTP proxy and file-server binaries (normally invoked by `bun run dev`).
- `bun ./docker_src/build.ts` - Build a single multi-version container image that includes all supported Paper versions (1.21.7, 1.21.8, 1.21.10) with architecture-specific binaries for amd64 and arm64. Uses Docker buildx for multi-platform builds and caches results to `.BASE_DOCKERFILE`.

## Architecture

### Core Components
- **Main worker** (`src/worker.ts`) – Elysia-based API layer handling authentication, REST endpoints (`/api/*`), WebSocket upgrades, and SPA asset serving.
- **Minecraft container** (`src/container.ts`) – Durable Object (`MinecraftContainer`) orchestrating the Minecraft server lifecycle, plugin state, RCON, HTTP proxy channels, and R2 backups.
- **Container image sources** (`container_src/`, `docker_src/`) – Bun services, helper binaries, and Dockerfiles used by Alchemy to build Cloudflare Container images.
- **Dynmap worker** (`src/dynmap-worker.ts`) – Separate Worker serving Dynmap tiles from the public R2 bucket with iframe-friendly CSP headers.
- **MCP agent worker** (`src/agent.ts`) – Model Context Protocol worker exposing Mineflare tooling, protected by OAuth helpers in `src/server/mcp-oauth.ts`.

### Request Flow
1. Requests enter the main worker; `/auth/*` routes are served by `src/server/auth.ts` (with optional CORS in dev).
2. Auth middleware validates `mf_auth` cookies unless the request targets auth endpoints or WebSocket upgrades.
3. Worker RPCs into the `MinecraftContainer` Durable Object for lifecycle, plugin, log, backup, and R2 operations.
4. The container communicates with the Minecraft process via RCON (port 25575) and exposes helper services on:
   - 8082 – log tail (hteetp)
   - 8083 – file server + backup/restore API
   - 8084 – HTTP proxy control channel
   - 8085-8100 – HTTP proxy data channels for R2 access (16 channels)
   - 7681-7684 – ttyd terminals (Claude, Codex, Gemini, Bash)
   - 5900 – x11vnc VNC server
   - 6080 – websockify (VNC-to-WebSocket proxy)
   - 6090 – Browser control API (xdotool navigation)
5. The Preact SPA polls REST endpoints every 5 seconds for status/player/plugin data and uses WebSockets for the RCON console and ttyd terminal.

### Key Infrastructure
- **Alchemy** – Provisioning Cloudflare Workers, Containers, and R2 buckets; `alchemy.run.ts` defines the full stack.
- **HTTP proxy** – Bun binary exposing S3-compatible control/data channels so the container can reach R2 without embedding real credentials.
- **Session tracking** – SQLite `container_sessions` table records run durations with `/api/session/*` endpoints surfacing analytics.
- **Automated backups** – `MinecraftContainer.performBackup()` pauses saves, uploads `/data` to the private R2 bucket, and resumes Dynmap rendering before shutdown.
- **Tailscale** – Optional VPN enabled via `TS_AUTHKEY` build secret; env vars injected through `envVars`.

## Directory Structure

```
src/
├── worker.ts                # Main worker (Elysia API + WebSocket handling)
├── container.ts             # MinecraftContainer Durable Object
├── dynmap-worker.ts         # Dynmap asset worker
├── agent.ts                 # MCP agent worker entrypoint
├── server/
│   ├── auth.ts              # Cookie-based auth, cache seeding, WebSocket token issuing
│   ├── get-minecraft-container.ts  # Helper for acquiring the container binding
│   └── mcp-oauth.ts         # OAuth 2.1/OIDC helpers for MCP consumers
├── client/
│   ├── App.tsx              # SPA root component
│   ├── components/          # UI components (ServerStatus, Plugins, Terminal, etc.)
│   ├── hooks/               # Polling + auth hooks (e.g. `useServerData`)
│   └── utils/               # API wrappers (`fetchWithAuth`, env helpers)
├── lib/
│   ├── rcon.ts              # Cloudflare-compatible RCON client
│   └── rcon-schema.ts       # Zod models for RCON responses
├── terminal/                # Multi-terminal interface (Claude, Codex, Gemini, Browser)
│   ├── index.html           # Terminal UI with tabs
│   └── terminal.ts          # Terminal WebSocket handling + URL detection
└── browser/                 # Embedded browser (noVNC client)
    ├── index.html           # Browser iframe container
    └── browser.ts           # noVNC WebSocket client + clipboard sync

docker_src/
├── Dockerfile               # Base image with VNC, Chrome, AI CLIs
├── build-container-services.sh  # Downloads/compiles all binaries (http-proxy, ttyd, chrome, etc.)
├── start-with-services.sh   # Container entrypoint managing all services
├── browser-control.py       # HTTP server for Chrome navigation via xdotool (port 6090)
├── http-proxy.ts            # Source for Bun HTTP proxy binary
├── file-server.ts           # Source for Bun file server binary
├── http-proxy-*/            # Architecture-specific proxy binaries
├── file-server-*/           # File server binaries used by port 8083
├── hteetp-*/                # Log tail HTTP server binaries
├── ttyd-*/                  # ttyd binaries for AI terminals
├── claude-*/                # Claude Code CLI binaries
├── codex-*/                 # OpenAI Codex CLI binaries
├── gemini-*/                # Google Gemini CLI binaries
├── chrome-*.tar.gz          # Playwright Chromium bundles (extracted to /opt/chrome)
└── CLAUDE.md                # Container-level assistant instructions

dist/client/                 # Built SPA assets (generated by Vite)
alchemy.run.ts                # Alchemy IaC definition for workers, containers, R2
```

## Authentication System

**Cookie-Based Auth with Encrypted Tokens**
- First-time setup: POST `/auth/setup` hashes the password (PBKDF2), stores salt/hash/symmetric key, and seeds the worker cache.
- Login: POST `/auth/login` verifies credentials and returns a 7-day `mf_auth` cookie (AES-GCM token with random nonce & expiry).
- Cache layer: Worker cache stores `passwordSet` and symmetric key lookups to avoid waking the Durable Object on every request (bypassed when `MINEFLARE_RESET_PASSWORD_MODE` is true).
- WebSocket tokens: `/auth/ws-token` returns short-lived (20 min) tokens required for RCON and ttyd WebSockets; tokens are validated in `worker.ts` before upgrade.

**Important Auth Notes**
- Password must be ≥ 8 characters; `/auth/setup` is idempotent (409 when already configured unless reset mode is enabled).
- Cookie name `mf_auth` is HttpOnly, Secure (in production), and SameSite=Lax.
- Development mode enables permissive localhost CORS via Elysia `@elysiajs/cors` plugin.
- `MINEFLARE_RESET_PASSWORD_MODE=true` forces the next `/auth/setup` to reset credentials.

## Plugin System

**Plugin Management**
- Plugin specs live in `PLUGIN_SPECS` inside `src/container.ts`; Dynmap is always enabled, `playit-minecraft-plugin` is optional by default.
- Plugin enablement is stored in SQLite `state.json_data.optionalPlugins`; env vars per plugin land in `state.json_data.pluginEnv`.
- `/api/plugins` returns current plugin states without waking the container; `/api/plugins/:filename` toggles enablement or sets env vars (server must be stopped for env changes).

**Plugin States** (matches `getPluginState()` response)
- `ENABLED` – Running now, present in both desired & current env
- `DISABLED` – Not running, not queued to start
- `DISABLED_WILL_ENABLE_AFTER_RESTART` – Requested but not active until next start
- `ENABLED_WILL_DISABLE_AFTER_RESTART` – Active now but scheduled to disable on restart

**Adding Plugins**
1. Add the plugin spec to `PLUGIN_SPECS` (including `getStatus` if custom messaging is needed).
2. Place the plugin jar under `container_src/optional_plugins/` (or adjust Dockerfile to fetch externally).
3. Update `start-with-services.sh` if special initialization or env wiring is required.
4. Provide any required env var descriptions (`requiredEnv`).

## HTTP Proxy & Helper Services

- Control channel on port 8084 maintains a persistent JSON RPC loop to allocate/deallocate data channels.
- Data channels on ports 8085-8100 proxy HTTP requests/responses to `fetchFromR2()` inside the Durable Object.
- File server on port 8083 exposes `/data` for reads and accepts backup jobs via `?backup=true&backup_id=...`; progress is polled from `/backup-status?id=...`.
- Log tail on port 8082 streams the latest 1 MB of Minecraft logs.
- Proxy supports chunked encoding, conditional requests (`If-Match`, `If-None-Match`), multipart uploads, and bucket prefix handling for both Dynmap and private data.

## Embedded Browser System (noVNC/Chrome)

**Purpose**: Provide an in-container Chrome browser accessible via WebSocket for OAuth flows that require localhost redirects.

**Architecture**:
- **Xvfb** – Virtual X11 display (`:99`) running at 1280x720 resolution
- **x11vnc** – VNC server exposing the virtual display on port 5900 (no password, container-internal only)
- **websockify** – Proxies VNC (port 5900) to WebSocket (port 6080) for browser access
- **Chrome/Chromium** – Runs in kiosk mode (fullscreen, no window manager) displaying on `:99`
- **Browser control service** – Python HTTP server on port 6090 using `xdotool` to navigate Chrome programmatically

**Access Flow**:
1. User accesses `/src/browser/` (requires `mf_auth` cookie authentication)
2. Page loads `src/browser/index.html` and `src/browser/browser.ts` (compiled by Vite)
3. Frontend calls `/auth/ws-token` to get short-lived WebSocket token
4. Connects to `wss://{worker}/src/browser/ws?token={token}`
5. Worker validates token and forwards to `MinecraftContainer` Durable Object
6. Container routes to port 6080 (websockify), stripping path to `/`
7. websockify proxies binary VNC protocol from x11vnc (port 5900) to WebSocket
8. noVNC client (CDN-loaded) renders Chrome display in browser canvas

**URL Navigation**:
- Detected URLs in terminal output appear in "Detected Links" panel
- Clicking a URL calls `POST /api/browser/navigate` with `{url: "..."}`
- Worker forwards to `container.navigateBrowser(url)`
- Container HTTP POSTs to browser control service (port 6090)
- Python server restarts Chrome with the new URL:
  1. Writes URL to `/tmp/chrome-url.txt`
  2. Kills Chrome process (`pkill -9 chrome`)
  3. Restart loop detects crash and reads URL from file
  4. Restarts Chrome in kiosk mode with the new URL
- Browser tab automatically switches to show the navigation
- Chrome restart completes in ~2 seconds while keeping kiosk mode (fullscreen, no browser UI)

**OAuth Use Case** (e.g., Codex GitHub login):
1. Run `codex` in Codex terminal → outputs `https://github.com/login/device?user_code=...`
2. Click URL in Detected Links panel → Opens in embedded browser
3. Complete GitHub authentication in Chrome
4. OAuth redirects to `http://localhost:1455/auth/callback` (inside container)
5. Callback server displays authorization code
6. User copies code and continues in Codex

**Security Notes**:
- x11vnc runs with `-nopw` (no password) – **safe because it's container-internal on loopback only**
- WebSocket connections require authentication via short-lived tokens (20 min expiry)
- Browser HTML page requires `mf_auth` cookie (user must be logged in)
- TLS terminates at the Worker; WebSocket uses `wss://` in production

**Clipboard Support**:
- Bidirectional sync between local browser and remote Chrome
- Ctrl+V/Cmd+V pastes from local clipboard into Chrome
- Copy in Chrome → syncs to local clipboard
- Implemented via noVNC clipboard events and browser Clipboard API

## RCON System

- TCP connection to `localhost:25575` with password `minecraft` (safe inside Tailscale/private network).
- The `Rcon` class uses Cloudflare TCP sockets, retries connections with backoff, and serialises requests to avoid packet interleaving.
- Container utilities rely on RCON for backup orchestration (`save-all flush`, `save-off`, `dynmap pause/resume`), status queries, and terminal WebSocket forwarding.
- Worker exposes `getRconStatus`, `getRconPlayers`, and `getRconInfo` RPC methods used by `/api/status`, `/api/players`, and `/api/info` respectively.

## Container Lifecycle

**Start Sequence**
1. Worker calls `container.start()` via `/api/status` when a wake-up is needed.
2. `MinecraftContainer.start()` syncs optional plugin list and injects saved plugin env vars into `envVars`.
3. Container waits for the HTTP proxy/file server ports, kicks off `initHTTPProxy()` in the background, and records a session start.
4. On first boot after startup, the container triggers `dynmap fullrender world` to prime map tiles.
5. Frontend polls `/api/getState` (doesn’t wake the container) and `/api/status` (wakes when needed) every 5 seconds to render progress.

**Stop Sequence**
1. `/api/shutdown` triggers `MinecraftContainer.stop()` which records session stop data.
2. `performBackup()` flushes world data via RCON, pauses Dynmap rendering, and pushes `/data` to the private R2 bucket.
3. If backup succeeds the container is stopped with `SIGKILL`; if it fails the container falls back to `SIGTERM` for a graceful shutdown.
4. `onStop()` tears down the HTTP proxy loop and RCON connection.
5. `/api/session/last` and `/api/session/stats` surface the recorded session metrics (hours per month/year).

**Sleep Policy**
- `sleepAfter = "20m"`; once idle the container sleeps automatically.
- `/api/status` is the canonical wake-up path; other endpoints that call into the container expect it to be running and will return errors if it is stopped.

## Single Container, Multiple Paper Versions

**Rationale**
- All supported Paper Minecraft builds (1.21.7, 1.21.8, 1.21.10) are bundled in a single container image to avoid the complexity of managing multiple Cloudflare Container resources and binding swaps.
- This approach preserves Durable Object state (authentication, plugins, sessions) across version changes and eliminates cold starts when switching versions.
- Users can switch between versions instantly via the UI selector without losing their server configuration.

**Supported Versions**
- `1.21.7` - Legacy (older stable release)
- `1.21.8` - Stable (recommended for most users)
- `1.21.10` - Experimental (latest features, may have stability issues)

**How It Works**
- The selected version is stored in the Durable Object's SQLite `state.json_data.serverVersion` field (default: "1.21.8").
- When the container starts, `MinecraftContainer.start()` reads the stored version and sets `envVars.VERSION` before launching the Minecraft process.
- The `itzg/minecraft-server` base image honors the `VERSION` environment variable and loads the appropriate Paper build from `/opt/minecraft/server/<VERSION>`.
- Version-specific plugins (e.g., Dynmap) are symlinked by `start-with-services.sh` based on the `VERSION` environment variable.

**API Endpoints**
- `GET /api/version` - Returns current version, label (legacy/stable/experimental), supported versions, and whether changes are allowed (only when stopped).
- `POST /api/version` - Updates the server version; rejects requests with 409 if the server is running or 400 if the version is unsupported.

**UI Integration**
- The `VersionSelector` component displays three option cards (Legacy/Stable/Experimental) with visual indicators for the current selection.
- Version changes are only permitted when `serverState === 'stopped'`; the UI disables interaction and shows tooltips otherwise.
- Warnings inform users about world compatibility and backup recommendations when switching versions.

**Important Notes**
- Changing versions does not automatically restart the server; users must manually start after switching.
- World compatibility is the user's responsibility; downgrades may not be fully supported.
- Version-specific plugins (like Dynmap) are automatically selected based on the active version.

## R2 Bucket Integration

**Dynmap Storage**
- Dynmap writes to `/data/plugins/dynmap/web/tiles`; tiles sync to the public R2 bucket `dynmap-tiles` via the HTTP proxy.
- Dynmap worker (`src/dynmap-worker.ts`) serves tiles, redirects non-tile assets to the bucket domain, and ensures iframe embedding headers are present.
- Lifecycle rule deletes `tiles/world/*` objects older than 7 days to control storage costs.

**Private Data Storage**
- Backups of `/data` are written into a private R2 bucket (non-public, not emptied on destroy).
- `fetchFromR2()` routes requests to the correct bucket by stripping the bucket prefix and forwarding operations through the appropriate binding (`DYNMAP_BUCKET` or `DATA_BUCKET`).
- Multipart uploads, conditional HEAD/GET, and directory-style listings are supported for both buckets.

## Frontend (Preact SPA)

**Technology Stack**
- Preact 10 with Signals + hooks (`useServerData`) for state.
- Vite builds the SPA; assets are exported to `dist/client` and served by the worker.
- Styling is custom inline CSS (no CSS framework).
- Polling interval is 5 seconds; the hook avoids waking the container unnecessarily when stopped.

**Key Features**
- Start/stop controls with live startup step feedback and session timers.
- Player list, plugin management (with env editing when stopped), and usage statistics panels.
- RCON terminal using Eden Treaty WebSockets and `/auth/ws-token`; automatic reconnect with token refresh.
- Embedded Dynmap iframe sourced from `/api/dynmap-url`.
- Login/setup overlay with password reset support when `MINEFLARE_RESET_PASSWORD_MODE` is enabled.

**API Client Notes**
- `fetchWithAuth()` reloads the page on 401 to force re-authentication.
- Terminal WebSocket logic reloads the page if it encounters 401/Unauthorized closures.

## Important Development Notes

### Alchemy Framework
- `alchemy.run.ts` defines resources: Cloudflare Container (`MinecraftContainer`), Dynmap worker, private/public R2 buckets, DevTunnel, and MCP Durable Object namespace.
- Resources use `adopt: true` so existing Cloudflare assets can be managed without recreation.
- `await app.finalize()` is mandatory at the end of the config.
- Development state store uses SQLite; production uses `CloudflareStateStore` with encrypted state.

### Container Development
- Any change to `http-proxy.ts`, file server, or ttyd helpers requires rerunning `./docker_src/build-container-services.sh` (or `bun run dev`).
- Container image is built from the `docker_src` assets with architecture-specific binaries checked into the repo.
- Multi-version build process (`docker_src/build.ts`):
  - Builds a single container image containing all three Paper versions (1.21.7, 1.21.8, 1.21.10)
  - Multi-platform support for both amd64 and arm64 architectures
  - The Dockerfile installs all Paper server JARs and version-specific Dynmap plugins during the build stage
  - Uses Docker buildx with registry caching to minimize rebuild times
  - Image tag is written to `.BASE_DOCKERFILE` for Alchemy to consume
  - Runtime version selection is handled via `VERSION` environment variable
- Container logs are accessible via `/api/logs` only when the container is running; expect errors if the container is asleep.

### Environment Variables & Bindings
- `TS_AUTHKEY` – Optional Tailscale auth key (omit or set to `null` for no VPN).
- `NODE_ENV` – Propagated via bindings; `getNodeEnv()` reads `process.env.NODE_ENV` safely in Cloudflare Workers.
- `MINEFLARE_RESET_PASSWORD_MODE` – String boolean toggling auth reset behaviour.
- `DYNMAP_BUCKET_NAME`, `DATA_BUCKET_NAME` – Injected into `envVars` for proxy routing.
- R2 bucket bindings (`DYNMAP_BUCKET`, `DATA_BUCKET`) and the container binding (`MINECRAFT_CONTAINER`) are provided automatically by Alchemy.

### SQL Storage Patterns
- `state` table (id=1) stores JSON with `optionalPlugins` and `pluginEnv`; updates use `jsonb_patch` for atomic writes.
- `auth` table stores salt, password hash, symmetric key, and created timestamp; accessed via synchronous transactions during setup/login.
- `container_sessions` table records start/stop timestamps for runtime analytics exposed at `/api/session/*`.

### Common Pitfalls
- Most `/api/*` endpoints expect the container to be running; `/api/getState` and `/api/plugins` are safe when stopped.
- RCON is lazy-initialised; expect transient errors until the server is fully online.
- HTTP proxy initialisation occasionally fails during warm-up; constructor/backoff logic retries automatically.
- Terminal WebSocket and REST calls self-refresh on 401; unexpected reload loops often indicate stale cookies or reset mode.
- Plugin env changes require the server to be stopped; the UI enforces this but custom scripts should check as well.

### Testing and Debugging
- Logs: `curl https://{worker-url}/api/logs`
- Container state: `curl https://{worker-url}/api/getState`
- Server info (requires running server): `curl https://{worker-url}/api/info`
- Plugin list (works when stopped): `curl https://{worker-url}/api/plugins`
- Dynmap worker URL: `curl https://{worker-url}/api/dynmap-url`
- Session stats: `curl https://{worker-url}/api/session/stats`
- Terminal WebSocket: `wss://{worker-url}/ws?token={ws-token}` (RCON) and `wss://{worker-url}/src/terminal/{claude|codex|gemini|bash}/ws?token={ws-token}` (ttyd)
- Browser WebSocket: `wss://{worker-url}/src/browser/ws?token={ws-token}` (noVNC/websockify)
- Navigate browser: `curl -X POST https://{worker-url}/api/browser/navigate -H "Content-Type: application/json" -d '{"url":"https://example.com"}'`
- Browser control health: `curl http://localhost:6090/health` (container-internal)

## AI Terminal System

**Multi-Terminal Interface** (`/src/terminal/`)
- Unified interface with tabs for Claude Code, OpenAI Codex, Google Gemini, and a standard Bash shell
- Plus embedded Chrome browser tab for OAuth flows
- All terminals use ttyd with shared PTY mode (`-Q` flag)
- Terminal dimensions controlled by server (160x80), not individual clients
- Late-joining clients receive snapshots to sync terminal state
- WebSocket connections use `tty` subprotocol and binary framing

**Terminal Ports**:
- 7681 – Claude Code terminal (runs `claude` binary)
- 7682 – OpenAI Codex terminal (runs `codex` binary)
- 7683 – Google Gemini terminal (runs `bash` - Gemini requires API key setup)
- 7684 – Bash shell terminal

**URL Detection**:
- Terminal output is scanned for URLs using regex pattern
- Handles URLs that wrap across multiple lines (terminal width: 160 columns)
- Unwraps split URLs before detection to capture complete OAuth URLs
- Detected URLs appear in "Detected Links" panel (bottom-right)
- Clicking a URL navigates the embedded browser and switches to browser tab
- Critical for OAuth flows (Codex GitHub login, etc.)

**Gemini API Key Handling**:
- First access prompts for API key (stored in browser localStorage)
- Key is injected into Gemini session via exported env var
- Settings file written to `/data/.gemini/settings.json`

## Code Style and Conventions

- TypeScript strict mode is enabled across the project.
- Elysia (not Hono) powers the API; keep middleware and routes consistent with Elysia patterns.
- Prefer async/await over raw promises for readability in Workers/DO code.
- Log with `console.error()` (Cloudflare recommends stderr for visibility).
- Durable Object RPC methods should remain async for ease of consumption from the worker.
- Keep files ASCII unless existing code already uses Unicode.
- MCP worker expects every request to include `Authorization: Bearer <token>` per `docs/mcp/AUTH.md`; missing headers should return 401 with `WWW-Authenticate` metadata.
