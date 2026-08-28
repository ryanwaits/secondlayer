/**
 * The canonical row shape names its system columns `_id`, `_blockHeight`,
 * `_txId`, `_createdAt`. These map to the snake_case DB columns the query
 * params use.
 */
const SYSTEM_COLUMN_MAP: Record<string, string> = {
	_blockHeight: "_block_height",
	_txId: "_tx_id",
	_createdAt: "_created_at",
	_id: "_id",
};

/**
 * Unprefixed shorthands for the same system columns. They are a convenience,
 * not reserved names: a subgraph is free to declare its own `id` or
 * `blockHeight` column, and when it does, the shorthand means that column.
 */
const SYSTEM_COLUMN_ALIASES: Record<string, string> = {
	blockHeight: "_block_height",
	txId: "_tx_id",
	createdAt: "_created_at",
	id: "_id",
};

/** The declared column names of one table, when the caller knows them. */
export type DeclaredColumns = ReadonlySet<string>;

/**
 * Resolve a where/orderBy key to the DB column name. Canonical `_x` names
 * always map. An unprefixed alias maps only when the table does not declare a
 * column of that name; with no declared column set (an untyped call) the
 * alias still maps, which is the pre-existing behavior.
 */
function resolveColumn(col: string, columns?: DeclaredColumns): string {
	const canonical = SYSTEM_COLUMN_MAP[col];
	if (canonical) return canonical;
	if (columns?.has(col)) return col;
	return SYSTEM_COLUMN_ALIASES[col] ?? col;
}

/**
 * Serializes a WhereInput object into the flat filter map expected by
 * SubgraphQueryParams.filters (and the REST API query string).
 *
 * Scalar values → `{ column: "value" }`
 * Comparison objects → `{ "column.gte": "100", "column.lt": "200" }`
 * System columns → `_blockHeight` always → `_block_height`; the unprefixed
 * `blockHeight` too, unless `columns` declares a user column of that name.
 */
export function serializeWhere(
	where: Record<string, unknown>,
	columns?: DeclaredColumns,
): Record<string, string> {
	const filters: Record<string, string> = {};

	for (const [column, value] of Object.entries(where)) {
		if (value === null || value === undefined) continue;

		const col = resolveColumn(column, columns);

		if (typeof value === "object" && !Array.isArray(value)) {
			const ops = value as Record<string, unknown>;
			for (const [op, opValue] of Object.entries(ops)) {
				if (opValue === null || opValue === undefined) continue;
				if (op === "eq") {
					filters[col] = String(opValue);
				} else if (op === "in" || op === "notIn") {
					// Array → comma list. Values can't contain commas (principals,
					// numbers, hashes don't) — the server splits on `,`.
					const arr = Array.isArray(opValue) ? opValue : [opValue];
					filters[`${col}.${op}`] = arr.map((v) => String(v)).join(",");
				} else if (["neq", "gt", "gte", "lt", "lte", "like"].includes(op)) {
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
 * Resolves an orderBy column name (either alias or canonical) to the DB column
 * name, with the same declared-column rule as {@link serializeWhere}.
 */
export function resolveOrderByColumn(
	col: string,
	columns?: DeclaredColumns,
): string {
	return resolveColumn(col, columns);
}
