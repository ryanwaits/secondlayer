# @secondlayer/shared

Foundational utilities for Second Layer services: DB layer (Kysely+Postgres), job queue, Zod schemas, HMAC signing, Stacks node clients.

## Testing

```bash
# Run tests (DB tests skip without DATABASE_URL)
bun test

# Run with database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/streams_test bun test
```

## Migrations

```bash
DATABASE_URL=... bun run migrate
```

## Contracts

Query helpers for the `contracts` table:

```typescript
import { searchContracts, getContract, cacheContractAbi } from "@secondlayer/shared/db/queries/contracts";

// Search by name or contract_id (uses pg_trgm for fast ILIKE)
const { contracts, total } = await searchContracts(db, "bns", 20, 0);

// Get single contract by ID
const contract = await getContract(db, "SP000000000000000000002Q6VF78.bns");

// Cache ABI fetched from Stacks node
await cacheContractAbi(db, "SP000000000000000000002Q6VF78.bns", abiJson);
```

Response schemas (`@secondlayer/shared/schemas`):

- `ContractSummary` — contractId, name, deployer, deployBlock, callCount, lastCalledAt, createdAt
- `ContractDetail` — extends summary with deployTxId, abi, updatedAt
- `SearchContractsResponse` — { contracts: ContractSummary[], total: number }
