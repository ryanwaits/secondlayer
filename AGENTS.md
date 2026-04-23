# Secondlayer AGENTS.md

## Monorepo Structure

- **apps/**: Web app
- **packages/**: CLI, SDK, API, indexer, worker, subgraphs, stacks, shared utils, etc.
- **scripts/**: Dev orchestration

Build order matters:
```bash
# Correct sequence (root package.json encodes this)
bun run build:stacks && bun run build:docs && bun run build:shared && bun run build:subgraphs && bun run build:bundler && bun run build:scaffold && bun run build:sdk && bun run build:cli
```

## Development Commands

```bash
# Start dev environment
bun run start          # or: bash scripts/dev.sh

# Database (Docker required)
bun run db             # Start postgres
bun run migrate        # Run migrations
bun run db:reset       # Wipe and recreate

# Testing
bun run test           # All packages
bun run test:cli       # Single package
bun test               # Current package only (uses bun:test)

# Type checking
bun run typecheck      # All packages

# Build
bun run build          # Full build with dependency order
```

## Toolchain

- **Runtime/Package Manager**: Bun (no npm, pnpm, yarn)
- **Formatter/Linter**: Biome (see `biome.json`)
- **Test Runner**: `bun test` (built-in)
- **Build**: `bunup` for most packages
- **Workspace**: Bun workspaces, not turbo

Always prefer `bunx` over `npx`.

## Key Package Relationships

| Package | Depends On | Notes |
|---------|------------|-------|
| `@secondlayer/stacks` | — | Foundational, build first |
| `@secondlayer/shared` | stacks | DB utils, shared types |
| `@secondlayer/sdk` | shared | Client SDK (subgraphs) |
| `@secondlayer/subgraphs` | shared, sdk | Subgraph processing |
| `@secondlayer/cli` | sdk, shared, subgraphs, stacks | CLI tool |

## CI/CD Requirements

Deploy workflow runs on push to `main`:
1. **typecheck** job must pass (builds, then typechecks)
2. **deploy** job SSHs to server and runs `docker/scripts/deploy.sh`
3. **notify** sends Slack webhook

Drift CI runs on PRs for docs sync detection.

## Testing Notes

- Uses `bun:test` (expect, test, describe, it available globally)
- CLARINET SDK required for some CLI tests (`@hirosystems/clarinet-sdk`)
- React testing requires `@tanstack/react-query` as peer

## Code Style

- Biome enforces tab indentation
- Organize imports enabled (auto-sort on save if using Biome)
- No autofocus accessibility rule disabled (see biome.json)

## Environment

- Node.js >= 20.19.0 required
- Postgres required for local development (via Docker)
- `DATABASE_URL` required for API, indexer, worker

## Release Process

Uses Changesets:
```bash
bun run changeset      # Add changeset
bun run version        # Bump versions
bun run release        # Build + publish to npm
```

## Inherited Instructions

- Root `CLAUDE.md`: Be extremely concise, sacrifice grammar for concision
- `packages/stacks/CLAUDE.md`: Bun-first conventions, no Node/npm
