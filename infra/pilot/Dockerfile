# syntax=docker/dockerfile:1
# Pilot image: quest script + headless lite runner for ONE fleet bot.
# Build context = repo root:  docker build -f infra/pilot/Dockerfile .
# Runtime secrets (bot.env) are bind-mounted at /opt/fleet/bots — never baked in.

FROM oven/bun:debian

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt update && apt install -y --no-install-recommends \
    ca-certificates bash

WORKDIR /opt/fleet

# === DEPENDENCY LAYER (cached unless the manifest changes) ===
# sdk/ has no manifest (relative imports only); only webclient needs install.
COPY server/webclient/package.json server/webclient/bun.lock /opt/fleet/server/webclient/
WORKDIR /opt/fleet/server/webclient
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install

# === SOURCE LAYER (rebuilds on code changes, deps stay cached) ===
# .dockerignore keeps node_modules, out/, logs, and .git out of the context.
WORKDIR /opt/fleet
COPY sdk /opt/fleet/sdk
COPY server/webclient /opt/fleet/server/webclient
COPY bots/quests /opt/fleet/bots/quests
# NOTE: bots/<name>/ (bot.env, park.json, roster.json) is bind-mounted
# from /srv/fleet/bots on the host — see compose.yml.
