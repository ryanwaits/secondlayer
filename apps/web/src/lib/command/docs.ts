// Product documentation strings for AI agent context
// Derived from @secondlayer/shared/schemas — kept as plain strings
// so the agent can reason about real schema shapes.

export function getStreamFilterDocs(): string {
  return `## Stream Filter Types

Streams use filters to match on-chain events. Each filter has a \`type\` discriminant and optional fields.

### STX Filters

**stx_transfer** — Match STX token transfers
- sender?: string (Stacks principal)
- recipient?: string (Stacks principal)
- minAmount?: number (microSTX, positive integer)
- maxAmount?: number (microSTX, positive integer)

**stx_mint** — Match STX minting events
- recipient?: string
- minAmount?: number

**stx_burn** — Match STX burn events
- sender?: string
- minAmount?: number

**stx_lock** — Match STX locking (stacking)
- lockedAddress?: string
- minAmount?: number

### Fungible Token (FT) Filters

**ft_transfer** — Match fungible token transfers
- sender?: string
- recipient?: string
- assetIdentifier?: string (contract that defines the token, e.g. SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wstx)
- minAmount?: number

**ft_mint** — Match FT minting
- recipient?: string
- assetIdentifier?: string
- minAmount?: number

**ft_burn** — Match FT burning
- sender?: string
- assetIdentifier?: string
- minAmount?: number

### Non-Fungible Token (NFT) Filters

**nft_transfer** — Match NFT transfers
- sender?: string
- recipient?: string
- assetIdentifier?: string
- tokenId?: string (Clarity value as hex)

**nft_mint** — Match NFT minting
- recipient?: string
- assetIdentifier?: string
- tokenId?: string

**nft_burn** — Match NFT burning
- sender?: string
- assetIdentifier?: string
- tokenId?: string

### Smart Contract Filters

**contract_call** — Match contract function calls
- contractId?: string (Stacks principal, e.g. SP2J...ABC.contract-name)
- functionName?: string (supports wildcards with *)
- caller?: string

**contract_deploy** — Match contract deployments
- deployer?: string
- contractName?: string (supports wildcards)

**print_event** — Match smart contract print events
- contractId?: string (contract emitting the event)
- topic?: string (event topic/name)
- contains?: string (substring match in event data)

### Notes
- All address fields must be valid Stacks principals (standard or contract format)
- Amounts are in microSTX (1 STX = 1,000,000 microSTX)
- All fields are optional — an empty filter matches all events of that type
- A stream must have at least one filter`;
}

export function getStreamCreationDocs(): string {
  return `## Creating a Stream

POST /api/streams with body:

\`\`\`
{
  name: string (1-255 chars, required),
  endpointUrl: string (valid URL, required),
  filters: StreamFilter[] (at least 1 required),
  options?: {
    decodeClarityValues: boolean (default: true),
    includeRawTx: boolean (default: false),
    includeBlockMetadata: boolean (default: true),
    rateLimit: number (1-100, default: 10, requests per second),
    timeoutMs: number (1-30000, default: 10000),
    maxRetries: number (0-10, default: 3)
  },
  startBlock?: number (positive integer, backfill from this block),
  endBlock?: number (positive integer, stop at this block)
}
\`\`\`

### Example: Track contract calls
\`\`\`json
{
  "name": "DEX Trades",
  "endpointUrl": "https://example.com/streams",
  "filters": [
    { "type": "contract_call", "contractId": "SP2C2...DEX.swap" }
  ]
}
\`\`\`

### Example: Track large STX transfers
\`\`\`json
{
  "name": "Whale Alerts",
  "endpointUrl": "https://example.com/whales",
  "filters": [
    { "type": "stx_transfer", "minAmount": 1000000000 }
  ]
}
\`\`\``;
}

export function getApiKeyDocs(): string {
  return `## API Keys

API keys authenticate requests to the Secondlayer API.

### Create
POST /api/keys with body: \`{ name?: string }\`
Returns: key object with prefix visible, full key shown once.

### Revoke
DELETE /api/keys/{id}

### Fields
- id: UUID
- prefix: string (first 8 chars, e.g. "sl_abc12...")
- name: string
- status: "active" | "revoked"`;
}

export function getSubgraphDocs(): string {
  return `## Subgraphs

Subgraphs are materialized query indexes over blockchain data.

### Fields
- name: string (unique identifier)
- status: "building" | "ready" | "failed"

### Navigation
Subgraphs are managed at /subgraphs in the dashboard.`;
}

export function getStreamManagementDocs(): string {
  return `## Stream Management

### Actions
- **Pause**: POST /api/streams/{id}/pause — temporarily stop deliveries
- **Resume**: POST /api/streams/{id}/resume — restart paused stream
- **Disable**: POST /api/streams/{id}/disable — fully disable a stream
- **Enable**: POST /api/streams/{id}/enable — re-enable a disabled stream
- **Replay failed**: POST /api/streams/{id}/replay-failed — retry failed deliveries
- **Delete**: DELETE /api/streams/{id} — permanently remove a stream

### Stream statuses
- **active**: running and delivering events
- **paused**: temporarily stopped, can be resumed
- **inactive**: disabled, must be enabled to start
- **failed**: errored out, check errorMessage field`;
}

export function getSubgraphScaffoldDocs(): string {
  return `## Subgraph Scaffold — defineSubgraph() API

Subgraphs are TypeScript indexers. Use \`defineSubgraph()\` to define schema, sources, and handlers.

### Structure
\`\`\`typescript
import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'my-subgraph',
  sources: [{ contract: 'SP...contract', event: 'swap' }],
  schema: {
    table_name: {
      columns: {
        col: { type: 'uint' },
      },
      uniqueKeys: [['col']],  // enables ctx.upsert()
    }
  },
  handlers: {
    'SP...contract::swap': (event, ctx) => {
      ctx.insert('table_name', { col: event.value });
    },
  },
});
\`\`\`

### Column Types
| Clarity | Column | Notes |
|---------|--------|-------|
| uint128 | uint | Token amounts, IDs |
| int128 | int | Signed values |
| principal | principal | Stacks addresses |
| bool | boolean | Flags |
| string-ascii/utf8 | text | Strings |
| buff | text | Hex buffers |
| optional<T> | type + nullable:true | Unwraps inner |
| tuple/list | jsonb | Complex data |

### Handler Patterns

**Insert:** \`ctx.insert('table', { col: event.value })\`
**Upsert (needs uniqueKeys):** \`ctx.upsert('table', { key: id }, { col: val })\`
**Update:** \`ctx.update('table', { id: 1 }, { col: newVal })\`
**Delete:** \`ctx.delete('table', { id: 1 })\`
**Read:** \`await ctx.findOne('table', { key: val })\`
**Read many:** \`await ctx.findMany('table', { key: val })\`

### Context
\`ctx.block.height\`, \`ctx.block.hash\`, \`ctx.block.timestamp\`
\`ctx.tx.txId\`, \`ctx.tx.sender\`, \`ctx.tx.type\`, \`ctx.tx.status\`

### Source Key Matching
Handler key MUST match the source key:
- \`{ contract: "SP...", event: "swap" }\` → handler key: \`"SP...::swap"\`
- \`{ contract: "SP...", function: "transfer" }\` → handler key: \`"SP...::transfer"\`
- \`{ contract: "SP..." }\` → handler key: \`"SP..."\`

### CLI
\`\`\`bash
sl subgraphs scaffold SP...contract -o subgraphs/name.ts
sl subgraphs deploy subgraphs/name.ts
sl subgraphs dev subgraphs/name.ts  # watch mode
\`\`\``;
}

export type DocTopic =
  | "stream-filters"
  | "stream-creation"
  | "api-keys"
  | "subgraphs"
  | "stream-management"
  | "subgraph-scaffold";

const topicMap: Record<DocTopic, () => string> = {
  "stream-filters": getStreamFilterDocs,
  "stream-creation": getStreamCreationDocs,
  "api-keys": getApiKeyDocs,
  "subgraphs": getSubgraphDocs,
  "stream-management": getStreamManagementDocs,
  "subgraph-scaffold": getSubgraphScaffoldDocs,
};

export function getDocsForTopic(topic: DocTopic): string {
  return topicMap[topic]();
}
