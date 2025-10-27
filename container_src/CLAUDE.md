You are running on a Minecraft server. The minecraft server is running in a Cloudflare Container based on the popular itzg/minecraft-server docker image.

The container is running on Cloudflare's Container Platform.

The playit.gg plugin and the Dynmap plugin are installed on the server automatically. Playit.gg is required for users to be able to join the server. Dynmap is used to display a map a server minimap on the server's web based control panel.

The code for the control panel is not in this container. The control panel is a separate Cloudflare Worker that is connected to the container, you can only make changes inside this container.

The /data directory is automatically backed up to Cloudflare R2 when the container is stopped and restored when the container is started.

If you kill the minecraft process, or it crashes, the process will be automatically restarted (the container will continue running, it will not stop). If you need to restart minecraft, for example to load a plugin, you can do so by killing the current running minecraft process and leaving it to the server script to restart it automatically.

By default the server is running PaperMC Minecraft 1.21.8 although it is possible the user has changed this. Checking the TYPE env var should tell you the type of minecraft server that is running.

The following software is installed on this machine:

OpenJDK version:
openjdk 21.0.8 2025-07-15 LTS
OpenJDK Runtime Environment Temurin-21.0.8+9 (build 21.0.8+9-LTS)
OpenJDK 64-Bit Server VM Temurin-21.0.8+9 (build 21.0.8+9-LTS, mixed mode, sharing)

- OpenJDK 21 (full JDK)
- Gradle (latest via SDKMAN)
- CLI/tools: git, curl, wget, ca-certificates, gnupg, unzip, zip, tar, rsync, jq, build-essential, pkg-config, libstdc++6, coreutils, findutils, sed, gawk, time, tree, net-tools, vim, nano

- Installs SDKMAN to `/usr/local/sdkman` and sources it globally via `/etc/profile.d/sdkman.sh`.
- Gradle installed via SDKMAN; OpenJDK 21 used as the Java runtime.

Most things you need are in the /data directory.

You can run rcon-cli to interact with the server by sending commands. To view the latest server stdout logs you can curl http://localhost:8082/ - this will return the most recent 1MB of logs it is advisable to delegate any investigation of the logs to a subagent instructed to use grep or tail on the output.

## File Server and Backup System

The container runs a file server on **port 8083** (`/opt/bun/scripts/file-server.ts`) that provides:

- **File serving** from the container filesystem
- **Backup to R2** - Create tar.gz archives and upload to Cloudflare R2
- **Restore from R2** - Download and extract backups
- **List backups** - View available backups for a directory

### CRITICAL: Valid Backup Paths

**⚠️ ONLY backups from paths under `data/` will be restored on container restart.**

- ✅ Valid: `data/mineflare-cli`, `data/plugins`, `data/world`, `data/config`, etc.
- ❌ Invalid: Any path outside `data/` (e.g., `/opt/`, `/tmp/`, `/root/`)

Backups of directories outside `data/` will be created but **will NOT be automatically restored** when the container restarts. Only backup paths that need to persist across container restarts.

### Triggering Backups

**Synchronous backup** (blocks until complete):
```bash
curl "http://localhost:8083/<directory_path>?backup=true"
```

**Background backup** (returns immediately, recommended for large directories):
```bash
# Start the backup
BACKUP_ID="backup_$(date +%s)"
curl "http://localhost:8083/<directory_path>?backup=true&backup_id=${BACKUP_ID}"

# Check status later
curl "http://localhost:8083/backup-status?id=${BACKUP_ID}" | jq .
```

**Examples**:
```bash
# Backup data directory (synchronous)
curl "http://localhost:8083/data?backup=true" | jq .

# Backup data directory (background)
BACKUP_ID="plugins_backup_$(date +%s)"
curl "http://localhost:8083/data?backup=true&backup_id=${BACKUP_ID}" | jq .
curl "http://localhost:8083/backup-status?id=${BACKUP_ID}" | jq .
```

### Restoring Backups

```bash
# List available backups for a directory
curl "http://localhost:8083/data/mineflare-cli?list_backups=true" | jq .

# Restore from a specific backup
curl "http://localhost:8083/data/mineflare-cli?restore=backups/3129840336_2025102623_data.tar.gz" | jq .
```

### Backup Details

- Backups are stored in R2 with reverse-epoch timestamps for newest-first ordering
- Format: `backups/<reverse_epoch>_<YYYYMMDDHH>_<dirname>.tar.gz`
- Excludes `./logs` and `./cache` directories automatically
- Large files (>100 MB) use multipart downloads with retry logic
- **Important**: Only backup `/data/` the auto restore functonality expects this

## mineflare Bot Controller

The `mineflare` CLI is available at `/opt/mineflare` as a node package. You can run it with bun (node is not installed but bun is). This is an AI-controlled Minecraft bot with HTTP API and CLI interface that can:

- **Join the Minecraft server** as a bot player and perform automated tasks
- **HTTP API** - REST endpoints for AI agents to control the bot programmatically
- **Event Logging** - Timestamped events (chat, health, spawns, player interactions, etc.)
- **Screenshots** - Base64 encoded screenshots of the bot's view
- **Block Manipulation** - Dig/break blocks, place blocks, full block interaction
- **Crafting System** - Craft items with recipes, check available recipes
- **Equipment Management** - Equip items to different slots
- **Real-time Control** - Move, jump, sprint, look around, attack entities, send chat
- **Batch Commands** - Execute multiple commands in sequence from JSON files

**Documentation**: Full documentation is available at `/docs/MINEFLARE_CLI.md` and `/docs/mineflare_EXECUTABLE.md`

The bot connects to localhost:25565 by default (the Minecraft server running in this container). You can configure it via environment variables or the `.env` file.

### Important: Bot Connection Timing

The mineflare bot server starts in **two phases**:

1. HTTP API becomes available immediately (~1 second)
2. Bot connects to Minecraft and spawns (~5-10 seconds)

**CRITICAL**: Always verify the bot is connected before running bot commands:

```bash
# Start the server (in /data/mineflare-cli directory)
cd /data/mineflare-cli
bun start > /tmp/mineflare.log 2>&1 &

# Wait for bot to connect (REQUIRED - do not skip this)
sleep 10

# Verify bot is connected before running commands
bun run mineflare health
# Should show: "botConnected": true

# If botConnected is false, wait longer and check again
sleep 5 && bun run mineflare health
```

**Checking Connection Status**:

```bash
# Method 1: Check health endpoint
bun run mineflare health
# Look for: "botConnected": true

# Method 2: Check server logs for spawn event
tail -20 /tmp/mineflare.log | grep "Bot spawned"

# Method 3: Check events
bun run mineflare events --since 0
# Should show a "spawn" event if connected
```

**Common Issues**:
- "Request failed with status code 400" - Bot not connected yet, wait longer
- "botConnected: false" - Connection in progress, wait 5-10 more seconds
- Port 3000 already in use - Clean up old process: `pkill -f "bun.*server.js"`

**Proper Startup Sequence**:

```bash
# 1. Navigate to directory
cd /data/mineflare-cli

# 2. Clean up any old processes
pkill -f "bun.*server.js" 2>/dev/null || true

# 3. Start server with logging
bun start > /tmp/mineflare.log 2>&1 &

# 4. Wait for connection (REQUIRED)
sleep 10

# 5. Verify connection
bun run mineflare health

# 6. Check bot state
bun run mineflare state

# Now safe to run bot commands
```

**Running Bot Commands**: Only run bot commands (move, dig, state, inventory, etc.) after confirming `botConnected: true`. The `chat` command may appear to succeed even when not connected, but the message won't actually be sent.
