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
- `./container_src/build-container-services.sh` - Manually rebuild the Bun-based HTTP proxy and file-server binaries (normally invoked by `bun run dev`).

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
   - 8082 – log tail
   - 8083 – file server + backup jobs (`?backup=true`)
   - 8084 – HTTP proxy control channel
   - 8085-8109 – HTTP proxy data channels for R2 access
   - 7681 – ttyd WebSocket (forwarded through `/src/terminal/ws`)
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
│   ├── terminal/            # Standalone terminal SPA assets
│   └── utils/               # API wrappers (`fetchWithAuth`, env helpers)
├── lib/
│   ├── rcon.ts              # Cloudflare-compatible RCON client
│   └── rcon-schema.ts       # Zod models for RCON responses
└── terminal/                # Worker-served terminal frontend (for ttyd)

container_src/
├── Dockerfile               # Cloudflare Container image build (wraps docker_src assets)
├── http-proxy.ts            # Source for Bun HTTP proxy binary
├── http-proxy               # Compiled proxy binary (checked in)
├── build-container-services.sh  # Rebuild proxy + file-server binaries
├── start-with-services.sh   # Container entrypoint (proxy, Minecraft, plugins, ttyd)
└── optional_plugins/        # Bundled optional plugin jars (playit.gg, etc.)

docker_src/
├── Dockerfile               # Base image for local/container builds
├── build.ts                 # Bun script to compile helper binaries for x64/arm64
├── http-proxy-*/            # Architecture-specific proxy binaries
├── file-server-*/           # File server binaries used by port 8083
├── ttyd-*/                  # ttyd binaries used for `/src/terminal/ws`
├── claude-*/                # Claude CLI binaries for shell agents
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
- Data channels on ports 8085-8109 proxy HTTP requests/responses to `fetchFromR2()` inside the Durable Object.
- File server on port 8083 exposes `/data` for reads and accepts backup jobs via `?backup=true&backup_id=...`; progress is polled from `/backup-status?id=...`.
- Log tail on port 8082 streams the latest 1 MB of Minecraft logs.
- Proxy supports chunked encoding, conditional requests (`If-Match`, `If-None-Match`), multipart uploads, and bucket prefix handling for both Dynmap and private data.

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
- Any change to `http-proxy.ts`, file server, or ttyd helpers requires rerunning `./container_src/build-container-services.sh` (or `bun run dev`).
- Container image is built from the `docker_src` assets with architecture-specific binaries checked into the repo.
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
- Terminal WebSocket: `wss://{worker-url}/ws?token={ws-token}` (RCON) and `wss://{worker-url}/src/terminal/ws?token={ws-token}` (ttyd)

## Code Style and Conventions

- TypeScript strict mode is enabled across the project.
- Elysia (not Hono) powers the API; keep middleware and routes consistent with Elysia patterns.
- Prefer async/await over raw promises for readability in Workers/DO code.
- Log with `console.error()` (Cloudflare recommends stderr for visibility).
- Durable Object RPC methods should remain async for ease of consumption from the worker.
- Keep files ASCII unless existing code already uses Unicode.
- MCP worker expects every request to include `Authorization: Bearer <token>` per `docs/mcp/AUTH.md`; missing headers should return 401 with `WWW-Authenticate` metadata.
