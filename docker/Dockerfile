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
COPY packages/subgraphs/package.json ./packages/subgraphs/
COPY packages/cli/package.json ./packages/cli/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/stacks/package.json ./packages/stacks/
COPY packages/clarity-docs/package.json ./packages/clarity-docs/
COPY packages/bundler/package.json ./packages/bundler/
COPY packages/scaffold/package.json ./packages/scaffold/
COPY packages/platform/package.json ./packages/platform/
# Install dependencies
RUN bun install

# =============================================================================
# Builder stage - build all packages
# =============================================================================
FROM deps AS builder

# Copy source code
COPY packages/stacks ./packages/stacks
COPY packages/shared ./packages/shared
COPY packages/subgraphs ./packages/subgraphs
COPY packages/sdk ./packages/sdk
COPY packages/api ./packages/api
COPY packages/worker ./packages/worker
COPY packages/indexer ./packages/indexer
COPY packages/bundler ./packages/bundler
COPY packages/platform ./packages/platform
COPY tsconfig.json ./

# Build all server packages (stacks must be built first as a dependency)
RUN bun run --filter '@secondlayer/stacks' --filter '@secondlayer/shared' --filter '@secondlayer/platform' --filter '@secondlayer/subgraphs' --filter '@secondlayer/bundler' --filter '@secondlayer/sdk' --filter '@secondlayer/api' --filter '@secondlayer/worker' --filter '@secondlayer/indexer' build

# =============================================================================
# API service
# =============================================================================
FROM base AS api

WORKDIR /app

ARG SECONDLAYER_API_SOURCE_DIGEST=unknown
LABEL org.opencontainers.image.secondlayer.api-source-digest=$SECONDLAYER_API_SOURCE_DIGEST

# Copy dependencies and built code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/stacks ./packages/stacks
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/subgraphs ./packages/subgraphs
COPY --from=builder /app/packages/bundler ./packages/bundler
COPY --from=builder /app/packages/indexer ./packages/indexer
COPY --from=builder /app/packages/sdk ./packages/sdk
COPY --from=builder /app/packages/api ./packages/api
COPY --from=builder /app/packages/platform ./packages/platform
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3800

EXPOSE 3800

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3800/health || exit 1

CMD ["bun", "run", "packages/api/src/index.ts"]

# =============================================================================
# Worker service
# =============================================================================
FROM base AS worker

WORKDIR /app

# Copy dependencies and built code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/stacks ./packages/stacks
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/platform ./packages/platform
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
COPY --from=builder /app/packages/sdk ./packages/sdk
COPY --from=builder /app/packages/indexer ./packages/indexer
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3700

EXPOSE 3700

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3700/health || exit 1

CMD ["bun", "run", "packages/indexer/src/index.ts"]

# =============================================================================
# L2 decoder service — same payload as the indexer image, dedicated default CMD
# so it versions/deploys/rolls back as its own image (no shared tag with indexer).
# =============================================================================
FROM indexer AS l2-decoder

ENV PORT=3710

EXPOSE 3710

HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3710/health || exit 1

CMD ["bun", "run", "packages/indexer/src/l2/service.ts"]

# =============================================================================
# Subgraph processor — same payload as the api image, dedicated default CMD.
# Runs no HTTP server, so it carries no healthcheck (liveness via restart policy).
# =============================================================================
FROM api AS subgraph-processor

HEALTHCHECK NONE

CMD ["bun", "run", "packages/subgraphs/src/service.ts"]

# =============================================================================
# Subscription processor — the real-time delivery plane. Same payload as the api
# image, dedicated default CMD, no HTTP server (no healthcheck).
# =============================================================================
FROM api AS subscription-processor

HEALTHCHECK NONE

CMD ["bun", "run", "packages/subgraphs/src/subscription-service.ts"]

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
COPY tools/ops/agent ./tools/ops/agent

ENV NODE_ENV=production

EXPOSE 3900

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3900/health || exit 1

CMD ["bun", "run", "tools/ops/agent/src/index.ts"]
