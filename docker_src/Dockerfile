# syntax=docker/dockerfile:1.6

# Multi-version Paper Minecraft container
# This image includes all supported Paper versions (1.21.7, 1.21.8, 1.21.10)
# The VERSION environment variable selects which version to run at runtime

# Stage for Paper installation - install all supported versions
FROM itzg/minecraft-server:latest AS paper-install
RUN mkdir -p /opt/minecraft/server/1.21.7 && /usr/bin/mc-image-helper install-paper \
    --project=paper \
    --version=1.21.7 \
    --output-directory=/opt/minecraft/server/1.21.7 \
    --results-file=/opt/minecraft/server/1.21.7/.paper-1.21.7.env

RUN mkdir -p /opt/minecraft/server/1.21.8 && /usr/bin/mc-image-helper install-paper \
    --project=paper \
    --version=1.21.8 \
    --output-directory=/opt/minecraft/server/1.21.8 \
    --results-file=/opt/minecraft/server/1.21.8/.paper-1.21.8.env

RUN mkdir -p /opt/minecraft/server/1.21.10 && /usr/bin/mc-image-helper install-paper \
    --project=paper \
    --version=1.21.10 \
    --output-directory=/opt/minecraft/server/1.21.10 \
    --results-file=/opt/minecraft/server/1.21.10/.paper-1.21.10.env

# Final stage - main image
FROM itzg/minecraft-server:latest

# First we do a bunch of heavy lifting to install the dependencies for paper plugin development
# this is first to maximize build caching
COPY --chmod=755 setup-paper-dev.sh /tmp/setup-paper-dev.sh

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        sudo \
        xvfb \
        x11vnc \
        wget \
        gnupg \
        python3 \
        x11-utils \
        xdotool \
        ripgrep \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && mkdir -p /opt/bun \
    && curl -fsSL https://bun.sh/install | bash && mkdir -p /opt/bun && mv /root/.bun /opt/bun \
    && mkdir -p $(dirname "${TAILSCALE_STATE_DIR}") \
    && mkdir -p /data/plugins \
    && echo "minecraft ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/minecraft \
    && chmod 0440 /etc/sudoers.d/minecraft \
    && chown -R 1000:1000 /opt/bun \
    && bash /tmp/setup-paper-dev.sh \
    && rm -rf /var/lib/apt/lists/*

# Install websockify (required by noVNC for VNC-to-WebSocket proxy)
RUN wget -qO- https://github.com/novnc/websockify/archive/refs/tags/v0.11.0.tar.gz | tar xz -C /opt \
    && mv /opt/websockify-0.11.0 /opt/websockify

ENV BUN_INSTALL=/opt/bun
ENV TAILSCALE_STATE_DIR=/var/lib/tailscale/tailscaled.state
ENV SERVER_PORT=25565
ENV TYPE=PAPER
# VERSION will be set at runtime by the container (default: 1.21.8)
ENV VERSION=1.21.8
ENV PATH="/opt/bun/bin:/data/.local/bin:${PATH}"


# Create directories for server jars and plugins outside /data
RUN mkdir -p /opt/minecraft/server /opt/minecraft/plugins

# Copy ALL pre-downloaded Paper versions from build stage
COPY --from=paper-install /opt/minecraft/server /opt/minecraft/server
RUN ls -la /opt/minecraft/server && chown -R 1000:1000 /opt/minecraft

COPY --chmod=755 start-with-services.sh /usr/local/bin/start-with-services.sh
COPY --chmod=755 browser-control.py /usr/local/bin/browser-control.py
COPY dynmap-configuration.txt /dynmap-configuration.txt
# Copy all available Dynmap jars, symlink will be set up by start script
COPY Dynmap-3.7-beta-11-spigot-*.jar /opt/minecraft/plugins/

# Copy bun-based source files that will be run directly
COPY --chmod=755 http-proxy.ts file-server.ts gemini.js /opt/bun/scripts/

# Copy all binaries to a temporary location. We will select the correct one for the
# target architecture in the next step.
COPY --chmod=755 \
    hteetp-linux-x64 hteetp-linux-arm64 \
    ttyd-x64 ttyd-arm64 \
    claude-x64 claude-arm64 \
    codex-x64 codex-arm64 \
    mineflare-x64 mineflare-arm64 \
    /tmp/

# Copy all Chrome binaries to a temporary location. We will select the correct one for the
# target architecture in the next step.
# Declare TARGETARCH early so we can use it in conditional statements
ARG TARGETARCH

COPY chrome-x64.tar.gz chrome-arm64.tar.gz /tmp/

# Select the correct binaries for the target architecture, move them to /usr/local/bin,
# create wrapper scripts for bun-based tools, and then clean up the temporary files.
# This is done in a single RUN command to ensure the unused binaries are not left in an intermediate layer.
RUN set -eux; \
    arch_suffix=''; \
    case "$TARGETARCH" in \
        "amd64") arch_suffix='x64' ;; \
        "arm64") arch_suffix='arm64' ;; \
        *) echo "Unsupported architecture: $TARGETARCH"; exit 1 ;; \
    esac; \
    mv "/tmp/hteetp-linux-$arch_suffix" /usr/local/bin/hteetp; \
    mv "/tmp/ttyd-$arch_suffix" /usr/local/bin/ttyd; \
    mv "/tmp/claude-$arch_suffix" /usr/local/bin/claude; \
    mv "/tmp/codex-$arch_suffix" /usr/local/bin/codex; \
    mv "/tmp/mineflare-$arch_suffix" /usr/local/bin/mineflare; \
    mkdir -p /opt/chrome; \
    tar -xzf "/tmp/chrome-$arch_suffix.tar.gz" -C /opt/chrome; \
    chmod -R 755 /opt/chrome; \
    rm -rf /tmp/*; \
    printf '#!/bin/sh\nexec /opt/bun/bin/bun run /opt/bun/scripts/http-proxy.ts "$@"\n' > /usr/local/bin/http-proxy; \
    printf '#!/bin/sh\nexec /opt/bun/bin/bun run /opt/bun/scripts/file-server.ts "$@"\n' > /usr/local/bin/file-server; \
    printf '#!/bin/sh\nexec /opt/bun/bin/bun run /opt/bun/scripts/gemini.js "$@"\n' > /usr/local/bin/gemini; \
    chmod +x /usr/local/bin/http-proxy /usr/local/bin/file-server /usr/local/bin/gemini

# Fetch latest mineflare-cli README and place in /docs for AI agent reference
RUN mkdir -p /docs/mineflare-cli \
    && curl -fsSL https://github.com/eastlondoner/mineflare-cli/raw/refs/heads/main/README.md \
        -o /docs/mineflare-cli/README.md \
    && curl -fsSL https://github.com/eastlondoner/mineflare-cli/raw/refs/heads/main/MINEFLARE_EXECUTABLE.md \
        -o /docs/mineflare-cli/MINEFLARE_EXECUTABLE.md \
    && curl -fsSL https://github.com/eastlondoner/mineflare-cli/raw/refs/heads/main/CONFIGURATION.md \
        -o /docs/mineflare-cli/CONFIGURATION.md \
    && chown -R 1000:1000 /docs

RUN mkdir -p /run/tailscale \
    && mkdir -p /data/plugins/spark \
    && echo '{"_header":"spark configuration file - https://spark.lucko.me/docs/Configuration","backgroundProfiler":false}' > /data/plugins/spark/config.json \
    && chown -R 1000:1000 /data \
    && chown -R 1000:1000 /run/tailscale

# Expose ports:
# === Minecraft Server ===
# 8080 - Health checks
# 25565 - Minecraft game traffic  
# 25575 - RCON console
#
# === Internal Services ===
# 8082 - Log tail (hteetp)
# 8083 - File server + backup API
# 8084 - HTTP proxy control channel
# 8085-8100 - HTTP proxy data channels (16 channels for R2 access)
#
# === AI Terminals (ttyd) ===
# 7681 - Claude terminal
# 7682 - Codex terminal
# 7683 - Gemini terminal
# 7684 - Bash terminal
#
# === Embedded Browser (noVNC/Chrome) ===
# 5900 - x11vnc (VNC server)
# 6080 - websockify (VNC-to-WebSocket proxy)
# 6090 - Browser control API (xdotool navigation)
#
EXPOSE 5900 6080 6090

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
