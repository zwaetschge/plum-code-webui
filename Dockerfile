# syntax=docker/dockerfile:1.7

# ============================================================================
# builder — full toolchain: installs deps + compiles native modules + builds
# shared types and frontend assets. Never deployed; image stays heavy.
# ============================================================================
FROM node:22.22.3-alpine AS builder

ARG PNPM_VERSION=9.15.0

# Native-module toolchain (better-sqlite3, node-pty build from source via node-gyp).
RUN apk add --no-cache python3 python3-dev py3-pip make g++ linux-headers git bash
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Manifest layer first — cache key for the dep install below.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# --frozen-lockfile so CI and prod resolve identical versions; fails loud if the
# lockfile drifts from package.json.
RUN pnpm install --frozen-lockfile

# Sources last — edits here don't bust the deps layer.
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/frontend ./packages/frontend

# Shared types compile before backend/frontend (both import from shared).
RUN pnpm --filter @plum-code-webui/shared build && \
    pnpm --filter @plum-code-webui/backend build && \
    pnpm --filter @plum-code-webui/frontend build && \
    pnpm --filter @plum-code-webui/backend deploy --prod /opt/backend-runtime && \
    find /opt/backend-runtime/node_modules -type d \
      \( -path '*/prebuilds/win32-*' -o -path '*/prebuilds/darwin-*' \) \
      -prune -exec rm -rf '{}' +


# ============================================================================
# runtime — slim image, no compiler toolchain. Native .node binaries are
# already built in `builder` and copied over via node_modules.
# ============================================================================
FROM node:22.22.3-alpine AS runtime

LABEL org.opencontainers.image.title="Plum Code WebUI"
LABEL org.opencontainers.image.description="Web-based interface for Codex, OpenCode, and Claude Code CLIs"
LABEL org.opencontainers.image.source="https://github.com/zwaetschge/plum-code-webui"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="Plum Code WebUI"

# Runtime OS tooling. gcompat + libstdc++ + libgcc let glibc-linked binaries
# (codex's Rust binary, opencode's Go binary) run on Alpine's musl libc —
# without these, the npm postinstall hits SIGILL when verifying the binary.
# blender-headless powers the built-in Blender MCP for background asset generation.
# `apk upgrade` first: the base image freezes its package set at its own build
# date, so imagemagick, libssh, openexr and python3 shipped with published CVE
# fixes already available in the repository. The image scan gates the pipeline
# on exactly those.
RUN apk upgrade --no-cache && \
    apk add --no-cache git bash docker-cli docker-cli-compose curl openssh-client unzip imagemagick gcompat libstdc++ libgcc python3 py3-pip pipx ripgrep py3-httpx jq coreutils tzdata chromium chromium-chromedriver nss freetype harfbuzz font-noto font-noto-cjk ttf-freefont xvfb blender-headless github-cli postgresql17-client

# User-writable npm prefix: the `node` user must be able to upgrade the AI CLIs
# at runtime (see services/cli-updates.ts). Mounted volume overlays this path.
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.local/bin:/home/node/.npm-global/bin:/opt/plum-cli/bin:$PATH
ENV CHROME_BIN=/usr/local/bin/plum-chromium
ENV CHROMIUM_BIN=/usr/local/bin/plum-chromium
ENV CHROMIUM_PATH=/usr/local/bin/plum-chromium
ENV BROWSER=/usr/local/bin/plum-chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/plum-chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/plum-chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV BLENDER_BIN=blender-headless
ENV GODOT_BIN=
ENV XDG_RUNTIME_DIR=/tmp/runtime-node
# Bake pinned fallback CLIs outside the persistent npm-global mount. Runtime
# updates still land in /home/node/.npm-global and win through PATH ordering,
# while a fresh installation is usable before any network update completes.
# The release build is native linux/amd64, so all four shipped harnesses are
# mandatory and version-smoke-tested instead of relying on an online bootstrap.
ARG CLAUDE_CODE_VERSION=2.1.220
ARG CODEX_VERSION=0.144.0
ARG OPENCODE_VERSION=1.17.17
ARG PI_CODING_AGENT_VERSION=0.83.0
ARG PI_MCP_ADAPTER_VERSION=2.11.0
# Pi dropped built-in Google Antigravity in 0.71.0; this community extension is
# the supported way back in — it registers an `antigravity` provider with its
# own OAuth flow. Ships TypeScript source with no install scripts.
ARG PI_ANTIGRAVITY_VERSION=0.3.0
ARG KIMI_CODE_VERSION=0.31.1
ARG NPM_VERSION=12.0.2
ARG NPM_BRACE_EXPANSION_VERSION=5.0.9
# Vendored inside npm itself and inside the Pi CLI; neither is reachable
# through our lockfile, so they are replaced in place like brace-expansion.
ARG NPM_IP_ADDRESS_VERSION=10.5.0
ARG PI_UNDICI_VERSION=8.10.0
# npm 12.0.2 still bundles tar 7.5.19 (CVE-2026-73566); drop this once an npm
# release ships tar >= 7.5.21.
ARG NPM_TAR_VERSION=7.5.21
RUN mkdir -p /home/node/.npm-global /opt/plum-cli && \
    npm install -g --prefix /opt/plum-cli \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      @earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION} \
      pi-mcp-adapter@${PI_MCP_ADAPTER_VERSION} \
      pi-antigravity@${PI_ANTIGRAVITY_VERSION} && \
    npm install -g --prefix /opt/plum-cli @openai/codex@${CODEX_VERSION} && \
    npm install -g --prefix /opt/plum-cli opencode-ai@${OPENCODE_VERSION} && \
    npm install -g --prefix /opt/plum-cli @moonshot-ai/kimi-code@${KIMI_CODE_VERSION} && \
    rm -f /opt/plum-cli/lib/node_modules/opencode-ai/bin/.opencode && \
    /opt/plum-cli/bin/claude --version && \
    /opt/plum-cli/bin/codex --version && \
    /opt/plum-cli/bin/opencode --version && \
    /opt/plum-cli/bin/kimi --version && \
    test -x /opt/plum-cli/bin/pi && \
    test -x /opt/plum-cli/bin/pi-mcp-adapter && \
    test -f /opt/plum-cli/lib/node_modules/pi-antigravity/src/index.ts && \
    npm install -g --prefix /usr/local npm@${NPM_VERSION} && \
    /usr/local/bin/npm --version | grep -Fx "${NPM_VERSION}" && \
    /usr/local/bin/npm pack brace-expansion@${NPM_BRACE_EXPANSION_VERSION} \
      --pack-destination /tmp --silent >/dev/null && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/brace-expansion && \
    mkdir -p /usr/local/lib/node_modules/npm/node_modules/brace-expansion && \
    tar -xzf /tmp/brace-expansion-${NPM_BRACE_EXPANSION_VERSION}.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
      --strip-components=1 && \
    rm -rf \
      /opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion && \
    mkdir -p \
      /opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion && \
    tar -xzf /tmp/brace-expansion-${NPM_BRACE_EXPANSION_VERSION}.tgz \
      -C /opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion \
      --strip-components=1 && \
    rm -f /tmp/brace-expansion-${NPM_BRACE_EXPANSION_VERSION}.tgz && \
    node -p \
      "require('/usr/local/lib/node_modules/npm/node_modules/brace-expansion/package.json').version" \
      | grep -Fx "${NPM_BRACE_EXPANSION_VERSION}" && \
    node -p \
      "require('/opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion/package.json').version" \
      | grep -Fx "${NPM_BRACE_EXPANSION_VERSION}" && \
    /usr/local/bin/npm pack ip-address@${NPM_IP_ADDRESS_VERSION} \
      --pack-destination /tmp --silent >/dev/null && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/ip-address && \
    mkdir -p /usr/local/lib/node_modules/npm/node_modules/ip-address && \
    tar -xzf /tmp/ip-address-${NPM_IP_ADDRESS_VERSION}.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/ip-address \
      --strip-components=1 && \
    rm -f /tmp/ip-address-${NPM_IP_ADDRESS_VERSION}.tgz && \
    node -p \
      "require('/usr/local/lib/node_modules/npm/node_modules/ip-address/package.json').version" \
      | grep -Fx "${NPM_IP_ADDRESS_VERSION}" && \
    /usr/local/bin/npm pack tar@${NPM_TAR_VERSION} \
      --pack-destination /tmp --silent >/dev/null && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/tar && \
    mkdir -p /usr/local/lib/node_modules/npm/node_modules/tar && \
    tar -xzf /tmp/tar-${NPM_TAR_VERSION}.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/tar \
      --strip-components=1 && \
    rm -f /tmp/tar-${NPM_TAR_VERSION}.tgz && \
    node -p \
      "require('/usr/local/lib/node_modules/npm/node_modules/tar/package.json').version" \
      | grep -Fx "${NPM_TAR_VERSION}" && \
    /usr/local/bin/npm pack undici@${PI_UNDICI_VERSION} \
      --pack-destination /tmp --silent >/dev/null && \
    rm -rf \
      /opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/undici && \
    mkdir -p \
      /opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/undici && \
    tar -xzf /tmp/undici-${PI_UNDICI_VERSION}.tgz \
      -C /opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/undici \
      --strip-components=1 && \
    rm -f /tmp/undici-${PI_UNDICI_VERSION}.tgz && \
    node -p \
      "require('/opt/plum-cli/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/undici/package.json').version" \
      | grep -Fx "${PI_UNDICI_VERSION}" && \
    /usr/local/bin/npm cache clean --force && rm -rf /root/.npm

WORKDIR /app

# Hoist only the backend's production dependency graph. Frontend build tools,
# TypeScript, linting packages, and browser-only dependencies stay in builder.
# `pnpm deploy` keeps native modules and the shared workspace package together.
COPY --from=builder --chown=node:node /opt/backend-runtime/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=builder --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=builder --chown=node:node /app/packages/backend/dist ./packages/backend/dist
# Claude's permission hook is a shell entrypoint; it dispatches to the compiled
# CLI in dist in production and keeps a tsx fallback for local development.
COPY --from=builder --chown=node:node /app/packages/backend/src/cli/permission-prompt-wrapper.sh ./packages/backend/src/cli/permission-prompt-wrapper.sh
COPY --from=builder --chown=node:node /app/packages/frontend/package.json ./packages/frontend/package.json
COPY --from=builder --chown=node:node /app/packages/frontend/dist ./packages/frontend/dist

# Helper scripts (mcp-comfyui, etc.) — no build step, copied as-is.
COPY --chown=node:node scripts ./scripts

RUN install -m 0755 ./scripts/chromium-webui.sh /usr/local/bin/plum-chromium && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/chromium && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/chromium-browser && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/google-chrome && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/google-chrome-stable

# Volume-friendly runtime dirs, owned by node:node (uid 1000).
# OpenCode uses XDG paths (~/.config/opencode for config, ~/.local/share/opencode
# for auth). Symlink both into the single /home/node/.opencode mount so one
# volume persists config + credentials across rebuilds.
#
# Codex CLI's skills system looks under ~/.agents/skills/<name>/SKILL.md (not
# ~/.claude/skills/). Symlink so the same skill packs work for both providers
# without duplication. Same idea for AGENTS.md / CLAUDE.md (Codex reads AGENTS.md).
RUN mkdir -p /home/node/.claude /home/node/.codex /home/node/.pi /home/node/.kimi-code \
             /home/node/.opencode/config /home/node/.opencode/share \
             /home/node/.config /home/node/.local/share /home/node/.agents \
             /tmp/runtime-node && \
    ln -sfn /home/node/.opencode/config /home/node/.config/opencode && \
    ln -sfn /home/node/.opencode/share /home/node/.local/share/opencode && \
    ln -sfn /home/node/.claude/skills /home/node/.agents/skills && \
    chown -R node:node /home/node /tmp/runtime-node

EXPOSE 3001
ENV NODE_ENV=production
ENV HOME=/home/node
ENV TZ=Etc/UTC

USER node

# Run the compile-checked backend directly; no runtime TypeScript loader or npx
# resolution is involved in production startup.
CMD ["node", "packages/backend/dist/index.js"]
