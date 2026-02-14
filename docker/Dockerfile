# syntax=docker/dockerfile:1

# =============================================================================
# Base stage - common dependencies
# =============================================================================
FROM oven/bun:1.3-alpine AS base

WORKDIR /app

# Install common dependencies
RUN apk add --no-cache curl

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
COPY packages/views/package.json ./packages/views/
COPY packages/cli/package.json ./packages/cli/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/stacks/package.json ./packages/stacks/
COPY packages/clarity-docs/package.json ./packages/clarity-docs/
# Install dependencies
RUN bun install --frozen-lockfile

# =============================================================================
# Builder stage - build all packages
# =============================================================================
FROM deps AS builder

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/auth ./packages/auth
COPY packages/views ./packages/views
COPY packages/api ./packages/api
COPY packages/worker ./packages/worker
COPY packages/indexer ./packages/indexer
COPY tsconfig.json ./

# Type check server packages (excludes CLI)
RUN bun run --filter '@secondlayer/shared' --filter '@secondlayer/auth' --filter '@secondlayer/views' --filter '@secondlayer/api' --filter '@secondlayer/worker' --filter '@secondlayer/indexer' build

# =============================================================================
# API service
# =============================================================================
FROM base AS api

WORKDIR /app

# Copy dependencies and built code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=deps /app/packages/views/node_modules ./packages/views/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/auth ./packages/auth
COPY --from=builder /app/packages/views ./packages/views
COPY --from=builder /app/packages/api ./packages/api
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
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/worker ./packages/worker
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV WORKER_CONCURRENCY=5

# Worker doesn't expose a port but we can add a simple health endpoint
CMD ["bun", "run", "packages/worker/src/index.ts"]

# =============================================================================
# Indexer service
# =============================================================================
FROM base AS indexer

WORKDIR /app

# Copy dependencies and built code
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/indexer/node_modules ./packages/indexer/node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/indexer ./packages/indexer
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3700

EXPOSE 3700

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3700/health || exit 1

CMD ["bun", "run", "packages/indexer/src/index.ts"]
