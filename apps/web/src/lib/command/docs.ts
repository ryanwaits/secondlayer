// Product documentation strings for AI agent context
// Derived from @secondlayer/shared/schemas — kept as plain strings
// so the agent can reason about real schema shapes.


export function getApiKeyDocs(): string {
	return `## API Keys

API keys authenticate requests to the Secondlayer API.

### Create
POST https://api.secondlayer.tools/api/keys with body: \`{ name?: string }\`
Returns: key object with prefix visible, full key shown once.

### Revoke
DELETE https://api.secondlayer.tools/api/keys/{id}

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

### API Base URL
https://api.secondlayer.tools/api/subgraphs/{name}/{table}

### Navigation
Subgraphs are managed at /subgraphs in the dashboard.
For querying data, use the "subgraph-query" documentation topic.`;
}

export function getSubgraphScaffoldDocs(): string {
	return `## Subgraph Scaffold — defineSubgraph() API

Subgraphs are TypeScript indexers. Use \`defineSubgraph()\` to define schema, sources, and handlers.

### Structure
\`\`\`typescript
import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'my-subgraph',
  sources: {
    swap: { type: 'print_event', contractId: 'SP...contract', topic: 'swap' },
  },
  schema: {
    table_name: {
      columns: {
        col: { type: 'uint' },
      },
      uniqueKeys: [['col']],  // enables ctx.upsert()
    }
  },
  handlers: {
    swap: (event, ctx) => {
      ctx.insert('table_name', { col: event.data.value });
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

**Insert:** \`ctx.insert('table', { col: value })\`
**Upsert (needs uniqueKeys):** \`ctx.upsert('table', { key: id }, { col: val })\`
**Update:** \`ctx.update('table', { id: 1 }, { col: newVal })\`
**Patch (partial update):** \`ctx.patch('table', { id: 1 }, { status: 'done' })\`
**PatchOrInsert:** \`await ctx.patchOrInsert('table', { addr }, { balance: (e) => (e?.balance ?? 0n) + amt })\`
**Delete:** \`ctx.delete('table', { id: 1 })\`
**Read:** \`await ctx.findOne('table', { key: val })\`
**Format:** \`ctx.formatUnits(1000000n, 6)\` → \`"1.000000"\`

### Context
\`ctx.block.height\`, \`ctx.block.hash\`, \`ctx.block.timestamp\`
\`ctx.tx.txId\`, \`ctx.tx.sender\`, \`ctx.tx.contractId\`, \`ctx.tx.functionName\`

### Named Sources
Sources are named objects. The name = handler key:
\`\`\`
sources: { swap: { type: 'contract_call', contractId: 'SP...', functionName: 'swap' } }
handlers: { swap: (event, ctx) => { ... } }
\`\`\`

Filter types: stx_transfer, ft_transfer, ft_mint, ft_burn, nft_transfer, nft_mint, nft_burn, contract_call, contract_deploy, print_event, stx_mint, stx_burn, stx_lock

### CLI
\`\`\`bash
sl subgraphs scaffold SP...contract -o subgraphs/name.ts
sl subgraphs deploy subgraphs/name.ts
sl subgraphs dev subgraphs/name.ts  # watch mode
\`\`\``;
}

export function getSubgraphQueryDocs(): string {
	return `## Querying Subgraph Data

Base URL: https://api.secondlayer.tools/api

### Endpoint
GET https://api.secondlayer.tools/api/subgraphs/{subgraph-name}/{table-name}

Auth: Authorization: Bearer <api-key>

### Query Parameters
- **_limit**: number (default 10, max 1000) — rows to return
- **_sort**: string (default "_id") — column to sort by
- **_order**: "asc" | "desc" (default "desc") — sort direction
- **_offset**: number — skip N rows (for pagination)
- **_search**: string — full-text search across all text/string columns

### Column Filtering
Filter by column value using dot-notation operators:
- \`{column}.eq=VALUE\` — exact match
- \`{column}.neq=VALUE\` — not equal
- \`{column}.gt=VALUE\` — greater than
- \`{column}.gte=VALUE\` — greater than or equal
- \`{column}.lt=VALUE\` — less than
- \`{column}.lte=VALUE\` — less than or equal
- \`{column}.like=VALUE\` — pattern match (use % as wildcard)

### Example: curl
\`\`\`bash
curl 'https://api.secondlayer.tools/api/subgraphs/my-subgraph/swaps?_limit=10&_sort=_created_at&_order=desc' \\
  -H 'Authorization: Bearer sk-sl_...'
\`\`\`

### Example: Node.js
\`\`\`javascript
const response = await fetch(
  'https://api.secondlayer.tools/api/subgraphs/my-subgraph/swaps?_limit=10&_sort=_id&_order=desc',
  { headers: { Authorization: \`Bearer \${apiKey}\` } }
);
const { data, meta } = await response.json();
\`\`\`

### Example: SDK
\`\`\`javascript
import { Secondlayer } from '@secondlayer/sdk';
const client = new Secondlayer();
const { data, meta } = await client
  .subgraph('my-subgraph')
  .table('swaps')
  .query({ limit: 10, sort: '_id', order: 'desc' });
\`\`\`

### Response Format
\`\`\`json
{
  "data": [{ "column1": "value", "column2": 123 }],
  "meta": { "total": 1234, "limit": 10, "offset": 0 }
}
\`\`\``;
}

export type DocTopic =
	| "api-keys"
	| "subgraphs"
	| "subgraph-scaffold"
	| "subgraph-query";

const topicMap: Record<DocTopic, () => string> = {
	"api-keys": getApiKeyDocs,
	subgraphs: getSubgraphDocs,
	"subgraph-scaffold": getSubgraphScaffoldDocs,
	"subgraph-query": getSubgraphQueryDocs,
};

export function getDocsForTopic(topic: DocTopic): string {
	return topicMap[topic]();
}
