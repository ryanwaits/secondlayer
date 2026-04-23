# syntax=docker/dockerfile:1

# =============================================================================
# Base stage - common dependencies
# =============================================================================
FROM oven/bun:1.3.10-alpine AS base

WORKDIR /app

# Install common dependencies
RUN apk add --no-cache curl zstd

# =============================================================================
# Dependencies stage - install all dependencies
# =============================================================================
FROM base AS deps

# Copy package files
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/auth/package.json ./packages/auth/
COPY packages/subgraphs/package.json ./packages/subgraphs/
COPY packages/cli/package.json ./packages/cli/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/stacks/package.json ./packages/stacks/
COPY packages/clarity-docs/package.json ./packages/clarity-docs/
COPY packages/agent/package.json ./packages/agent/
COPY packages/bundler/package.json ./packages/bundler/
COPY packages/scaffold/package.json ./packages/scaffold/
COPY packages/provisioner/package.json ./packages/provisioner/
# Install dependencies
RUN bun install

# =============================================================================
# Builder stage - build all packages
# =============================================================================
FROM deps AS builder

# Copy source code
COPY packages/stacks ./packages/stacks
COPY packages/shared ./packages/shared
COPY packages/auth ./packages/auth
COPY packages/subgraphs ./packages/subgraphs
COPY packages/api ./packages/api
COPY packages/worker ./packages/worker
COPY packages/indexer ./packages/indexer
COPY packages/bundler ./packages/bundler
COPY packages/provisioner ./packages/provisioner
COPY tsconfig.json ./

# Build all server packages (stacks must be built first as a dependency)
RUN bun run --filter '@secondlayer/stacks' --filter '@secondlayer/shared' --filter '@secondlayer/auth' --filter '@secondlayer/subgraphs' --filter '@secondlayer/bundler' --filter '@secondlayer/api' --filter '@secondlayer/worker' --filter '@secondlayer/indexer' build

# =============================================================================
# API service
# =============================================================================
FROM base AS api

WORKDIR /app

# Copy dependencies and built code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/stacks ./packages/stacks
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/auth ./packages/auth
COPY --from=builder /app/packages/subgraphs ./packages/subgraphs
COPY --from=builder /app/packages/bundler ./packages/bundler
COPY --from=builder /app/packages/api ./packages/api
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3800

EXPOSE 3800

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3800/health || exit 1

CMD ["bun", "run", "packages/api/src/index.ts"]

# =============================================================================
# Provisioner service — tenant Docker lifecycle HTTP API (platform mode).
# Needs /var/run/docker.sock passthrough at runtime.
# =============================================================================
FROM base AS provisioner

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
# @secondlayer/shared depends on @secondlayer/stacks via the workspace, so
# we must copy stacks even though the provisioner itself doesn't reference it.
COPY --from=builder /app/packages/stacks ./packages/stacks
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/provisioner ./packages/provisioner
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PROVISIONER_PORT=3850

EXPOSE 3850

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3850/health || exit 1

CMD ["bun", "run", "packages/provisioner/src/index.ts"]

# =============================================================================
# Worker service
# =============================================================================
FROM base AS worker

WORKDIR /app

# Copy dependencies and built code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/stacks ./packages/stacks
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/worker ./packages/worker
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production

CMD ["bun", "run", "packages/worker/src/index.ts"]

# =============================================================================
# Indexer service
# =============================================================================
FROM base AS indexer

WORKDIR /app

# Copy dependencies and built code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/stacks ./packages/stacks
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/indexer ./packages/indexer
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3700

EXPOSE 3700

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3700/health || exit 1

CMD ["bun", "run", "packages/indexer/src/index.ts"]

# =============================================================================
# Agent service - AI DevOps monitoring
# =============================================================================
FROM base AS agent

WORKDIR /app

# Install docker CLI for container management + bash for Agent SDK
RUN apk add --no-cache docker-cli bash

# Copy dependencies and agent code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./
COPY packages/agent ./packages/agent

ENV NODE_ENV=production

EXPOSE 3900

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3900/health || exit 1

CMD ["bun", "run", "packages/agent/src/index.ts"]
