/**
 * Maps camelCase system column names (with or without `_` prefix) to the
 * actual snake_case DB column names used in query params.
 */
const SYSTEM_COLUMN_MAP: Record<string, string> = {
  // underscore-prefixed camelCase (canonical row shape)
  _blockHeight: "_block_height",
  _txId: "_tx_id",
  _createdAt: "_created_at",
  _id: "_id",
  // no-prefix aliases
  blockHeight: "_block_height",
  txId: "_tx_id",
  createdAt: "_created_at",
  id: "_id",
};

function resolveColumn(col: string): string {
  return SYSTEM_COLUMN_MAP[col] ?? col;
}

/**
 * Serializes a WhereInput object into the flat filter map expected by
 * SubgraphQueryParams.filters (and the REST API query string).
 *
 * Scalar values → `{ column: "value" }`
 * Comparison objects → `{ "column.gte": "100", "column.lt": "200" }`
 * System column aliases → `blockHeight` / `_blockHeight` both → `_block_height`
 */
export function serializeWhere(
  where: Record<string, unknown>,
): Record<string, string> {
  const filters: Record<string, string> = {};

  for (const [column, value] of Object.entries(where)) {
    if (value === null || value === undefined) continue;

    const col = resolveColumn(column);

    if (typeof value === "object" && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      for (const [op, opValue] of Object.entries(ops)) {
        if (opValue === null || opValue === undefined) continue;
        if (op === "eq") {
          filters[col] = String(opValue);
        } else if (["neq", "gt", "gte", "lt", "lte"].includes(op)) {
          filters[`${col}.${op}`] = String(opValue);
        }
      }
    } else {
      filters[col] = String(value);
    }
  }

  return filters;
}

/**
 * Resolves an orderBy column name (either alias or canonical) to the DB column name.
 */
export function resolveOrderByColumn(col: string): string {
  return resolveColumn(col);
}
