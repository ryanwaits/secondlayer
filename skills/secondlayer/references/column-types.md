# Column Types

## Subgraph Column Types

| Type | PostgreSQL | Use for |
| --- | --- | --- |
| `text` | `text` | strings, contract ids, labels |
| `uint` | `bigint` | token amounts, counters, ids |
| `int` | `bigint` | signed amounts and deltas |
| `principal` | `text` | Stacks addresses and principals |
| `boolean` | `boolean` | flags |
| `timestamp` | `timestamptz` | dates and block times |
| `jsonb` | `jsonb` | nested data |

## Column Options

```typescript
columns: {
  sender: {
    type: "principal",
    indexed: true,
  },
  memo: {
    type: "text",
    nullable: true,
    search: true,
  },
  amount: {
    type: "uint",
    default: "0",
  },
}
```

Options:

- `nullable` — allows null values.
- `indexed` — creates a B-tree index.
- `search` — enables text search with `.like`.
- `default` — default insert value.

## Schema Options

```typescript
schema: {
  balances: {
    columns: {
      address: { type: "principal", indexed: true },
      token: { type: "text", indexed: true },
      amount: { type: "uint" },
    },
    indexes: [["token", "amount"]],
    uniqueKeys: [["address", "token"]],
  },
}
```

- `indexes` are composite indexes.
- `uniqueKeys` are unique constraints required by `ctx.upsert()`.

## System Columns

Every table gets:

| Column | Type | Description |
| --- | --- | --- |
| `_id` | serial-like id | row identifier |
| `_block_height` | `bigint` | block where the row was inserted |
| `_tx_id` | `text` | transaction id |
| `_created_at` | `timestamptz` | row insertion time |

## Clarity Mapping

| Clarity | Column |
| --- | --- |
| `uint128` | `uint` |
| `int128` | `int` |
| `principal` | `principal` |
| `trait_reference` | `principal` |
| `bool` | `boolean` |
| `string-ascii` / `string-utf8` | `text` |
| `buff` | `text` |
| `optional<T>` | inner mapped type plus `nullable: true` |
| `tuple` / `list` / `response` | `jsonb` |
