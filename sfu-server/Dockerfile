ARG NODE_VERSION=24-bookworm-slim

# --- Build stage (Node app) ---
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential python3-pip pkg-config libssl-dev git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY types /app/types
WORKDIR /app/sfu-server
COPY sfu-server/package.json sfu-server/yarn.lock sfu-server/tsconfig.json ./
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
RUN yarn install --frozen-lockfile
COPY sfu-server/src ./src
RUN yarn build

# --- Runtime stage ---
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app/sfu-server
ENV NODE_ENV=production \
  PORT=3000

# Install runtime deps: tini, ca-certificates, curl, ffmpeg, python3 (for faster-whisper)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates curl ffmpeg python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Install faster-whisper into a system venv
COPY sfu-server/stt-server /app/stt-server
RUN python3 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir -r /app/stt-server/requirements.txt && \
    mkdir -p /app/sfu-server/logs /app/.cache && \
    chown -R node:node /app

ENV HF_HOME=/app/.cache \
    XDG_CACHE_HOME=/app/.cache

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","dist/sfu-server/src/server.js"]

# ── Whisper runtime stage (NVIDIA CUDA) ─────────────────────────────────────
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS whisper-runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg curl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY sfu-server/stt-server /app/stt-server

RUN python3 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir -r /app/stt-server/requirements.txt && \
    mkdir -p /app/.cache && \
    chown -R nobody:nogroup /app

ENV HF_HOME=/app/.cache \
    XDG_CACHE_HOME=/app/.cache \
    WHISPER_BACKEND=faster-whisper \
    WHISPER_DEVICE=auto \
    WHISPER_COMPUTE_TYPE=auto

HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -fsS http://127.0.0.1:8080/health || exit 1

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/.venv/bin/python3", "/app/stt-server/server.py"]
