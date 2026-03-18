# Column Types Reference

## Clarity → Subgraph Column Mapping

| Clarity Type | Subgraph Column | PostgreSQL Type | Notes |
|-------------|----------------|-----------------|-------|
| `uint128` | `uint` | `bigint` | Token amounts, counters, IDs |
| `int128` | `int` | `bigint` | Signed integers |
| `principal` | `principal` | `text` | Stacks addresses (SP.../ST...) |
| `trait_reference` | `principal` | `text` | Trait implementations |
| `bool` | `boolean` | `boolean` | True/false flags |
| `string-ascii` | `text` | `text` | ASCII strings |
| `string-utf8` | `text` | `text` | UTF-8 strings |
| `buff` | `text` | `text` | Hex-encoded buffer data |
| `optional<T>` | (mapped type) | varies | Inner type + `nullable: true` |
| `tuple` | `jsonb` | `jsonb` | Stored as JSON object |
| `list` | `jsonb` | `jsonb` | Stored as JSON array |
| `response` | `jsonb` | `jsonb` | Complex response types |

## Column Options

```typescript
columns: {
  name: {
    type: "text",          // required
    nullable: true,        // allows NULL values (default: false)
    indexed: true,         // creates B-tree index for faster lookups
    search: true,          // enables ILIKE queries via ?name.like=pattern
    default: "unnamed",    // default value for inserts
  }
}
```

## Additional Column Types

| Subgraph Type | PostgreSQL Type | Use For |
|--------------|-----------------|---------|
| `serial` | `serial` | Auto-incrementing IDs |
| `timestamp` | `timestamptz` | Dates and times |
| `jsonb` | `jsonb` | Arbitrary nested data |

## System Columns (Auto-populated)

Every row automatically gets:

| Column | Type | Description |
|--------|------|-------------|
| `_id` | `serial` | Unique row identifier |
| `_block_height` | `bigint` | Block where row was inserted |
| `_tx_id` | `text` | Transaction ID that triggered the insert |
| `_created_at` | `timestamptz` | Timestamp of insertion |

## Schema Options

```typescript
schema: {
  my_table: {
    columns: { ... },
    indexes: [["col_a", "col_b"]],       // composite index
    uniqueKeys: [["col_a", "col_b"]],    // enables ctx.upsert()
  }
}
```

- `indexes`: array of column name arrays for composite B-tree indexes
- `uniqueKeys`: array of column name arrays for unique constraints (required for `ctx.upsert()`)
