import type { Subgraph } from "@secondlayer/shared/db";
import { pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";
import { ValidationError } from "@secondlayer/shared/errors";
import type {
	SubgraphColumn,
	SubgraphSchema,
} from "@secondlayer/subgraphs/types";

export const SYSTEM_COLUMNS = new Set([
	"_id",
	"_block_height",
	"_tx_id",
	"_created_at",
]);
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;

export const COMPARISON_OPS: Record<string, string> = {
	gte: ">=",
	lte: "<=",
	gt: ">",
	lt: "<",
	neq: "!=",
	like: "ILIKE",
};

// Set membership ops — value is a comma list, emitted as `IN ($1,$2,…)`.
export const IN_OPS: Record<string, string> = {
	in: "IN",
	notIn: "NOT IN",
};

export function ident(name: string): string {
	if (!/^[a-z0-9_]+$/i.test(name)) {
		throw new Error(`Invalid identifier: ${name}`);
	}
	return `"${name}"`;
}

export function subgraphSchemaName(subgraph: Subgraph): string {
	return subgraph.schema_name ?? pgSchemaName(subgraph.name);
}

export function getValidColumns(table: {
	columns: Record<string, SubgraphColumn>;
}): Set<string> {
	const cols = new Set(Object.keys(table.columns));
	for (const sc of SYSTEM_COLUMNS) cols.add(sc);
	return cols;
}

export function getSubgraphSchema(subgraph: Subgraph): SubgraphSchema {
	return (subgraph.definition.schema as SubgraphSchema) ?? {};
}

export class InvalidColumnError extends ValidationError {
	constructor(column: string) {
		super(`Unknown column: ${column}`);
	}
}

export class NonNumericColumnError extends ValidationError {
	constructor(column: string) {
		super(`Column is not numeric (uint/int): ${column}`);
	}
}

export class TooManyAggregatesError extends ValidationError {
	constructor(count: number) {
		super(
			`Too many aggregate columns: ${count} (max ${MAX_AGGREGATE_COLUMNS})`,
		);
	}
}

const KNOWN_OPS = [...Object.keys(COMPARISON_OPS), ...Object.keys(IN_OPS)];
// Matches known ops in "col=op.value" (PostgREST-style misplacement).
const VALUE_LOOKS_LIKE_OP = /^(gte|lte|gt|lt|neq|like|in|notIn)\./i;
// Matches any short lowercase word before "." — catches unknown ops like "bogus.1"
// without false-positiving on Stacks principals (uppercase) or hyphenated values.
const VALUE_LOOKS_LIKE_ANY_OP = /^([a-z]{2,6})\./;

export interface ParsedQuery {
	filters: {
		column: string;
		op: string;
		/** Single value for binary ops (=, >=, ILIKE…). */
		value?: string;
		/** Value set for IN / NOT IN. */
		values?: string[];
		isLike?: boolean;
	}[];
	/** Ordered sort columns (multi-column). Empty → caller defaults to `_id`. */
	sorts: { column: string; order: "ASC" | "DESC" }[];
	limit: number;
	offset: number;
	fields?: string[];
	search?: { value: string; columns: string[] };
}

export function parseQueryParams(
	params: Record<string, string>,
	validColumns: Set<string>,
	tableDef?: { columns: Record<string, SubgraphColumn> },
): ParsedQuery {
	const filters: ParsedQuery["filters"] = [];
	// Captured raw, zipped into `sorts` after the loop (params order is arbitrary).
	let sortRaw: string | undefined;
	let orderRaw: string | undefined;
	let limit = DEFAULT_LIMIT;
	let offset = 0;
	let fields: string[] | undefined;
	let search: ParsedQuery["search"];

	// Pagination params use underscore prefix to avoid column name collisions.
	const CONTROL_PARAMS = new Set([
		"limit",
		"offset",
		"sort",
		"order",
		"fields",
		"search",
	]);

	for (const [key, value] of Object.entries(params)) {
		if (CONTROL_PARAMS.has(key)) {
			throw new ValidationError(
				`use "_${key}" (with underscore) for pagination/control params, e.g. "_${key}=${value}"`,
			);
		}

		if (key === "_search") {
			const searchCols = tableDef
				? Object.entries(tableDef.columns)
						.filter(([, col]) => col.search)
						.map(([name]) => name)
				: [];
			if (searchCols.length > 0) {
				search = { value, columns: searchCols };
			}
			continue;
		}
		if (key === "_sort") {
			// One or more columns: "_sort=a,b". Validate each.
			for (const c of value.split(",").map((s) => s.trim())) {
				if (!validColumns.has(c)) throw new InvalidColumnError(c);
			}
			sortRaw = value;
			continue;
		}
		if (key === "_order") {
			orderRaw = value;
			continue;
		}
		if (key === "_limit") {
			limit = Math.min(
				Math.max(1, Number.parseInt(value, 10) || DEFAULT_LIMIT),
				MAX_LIMIT,
			);
			continue;
		}
		if (key === "_offset") {
			offset = Math.max(0, Number.parseInt(value, 10) || 0);
			continue;
		}
		if (key === "_fields") {
			fields = value.split(",").map((f) => f.trim());
			for (const f of fields) {
				if (!validColumns.has(f)) throw new InvalidColumnError(f);
			}
			continue;
		}

		// Comparison operators: column.op=value
		const dotIdx = key.lastIndexOf(".");
		if (dotIdx > 0) {
			const col = key.slice(0, dotIdx);
			const op = key.slice(dotIdx + 1);
			const comparisonOp = COMPARISON_OPS[op];
			if (comparisonOp) {
				if (!validColumns.has(col)) throw new InvalidColumnError(col);
				filters.push({
					column: col,
					op: comparisonOp,
					value,
					isLike: op === "like",
				});
				continue;
			}
			const inOp = IN_OPS[op];
			if (inOp) {
				if (!validColumns.has(col)) throw new InvalidColumnError(col);
				const values = value
					.split(",")
					.map((v) => v.trim())
					.filter((v) => v.length > 0);
				if (values.length === 0) {
					throw new ValidationError(`empty "${op}" list for column "${col}"`);
				}
				filters.push({ column: col, op: inOp, values });
				continue;
			}
			// Looks intentional (col.unknownOp) — reject explicitly with hint.
			if (validColumns.has(col)) {
				throw new ValidationError(
					`unknown filter operator "${op}" for column "${col}" (allowed: ${KNOWN_OPS.join(", ")})`,
				);
			}
		}

		// Catch "?col=op.value" — common typo for "?col.op=value".
		if (validColumns.has(key) && VALUE_LOOKS_LIKE_ANY_OP.test(value)) {
			const maybeOp = value.split(".", 1)[0]?.toLowerCase() ?? "";
			if (VALUE_LOOKS_LIKE_OP.test(value)) {
				throw new ValidationError(
					`filter "${key}=${value}" looks like a misplaced operator; use "${key}.${maybeOp}=<value>" instead`,
				);
			}
			throw new ValidationError(
				`unknown filter operator "${maybeOp}" in "${key}=${value}"; use dot notation "${key}.op=<value>" (allowed: ${KNOWN_OPS.join(", ")})`,
			);
		}

		// Equality filter
		if (!validColumns.has(key)) throw new InvalidColumnError(key);
		filters.push({ column: key, op: "=", value });
	}

	// Zip _sort + _order into ordered, parallel sort entries. Missing/short
	// _order defaults remaining columns to ASC.
	const sorts: ParsedQuery["sorts"] = [];
	if (sortRaw) {
		const cols = sortRaw.split(",").map((s) => s.trim());
		const dirs = (orderRaw ?? "").split(",").map((s) => s.trim().toLowerCase());
		cols.forEach((column, i) => {
			sorts.push({ column, order: dirs[i] === "desc" ? "DESC" : "ASC" });
		});
	}

	return { filters, sorts, limit, offset, fields, search };
}

export function buildWhereConditions(
	parsed: ParsedQuery,
	params: unknown[],
): string[] {
	const conditions: string[] = [];

	for (const f of parsed.filters) {
		if (f.values) {
			// IN / NOT IN — one placeholder per value, all parameterized.
			const placeholders = f.values.map((v) => {
				params.push(v);
				return `$${params.length}`;
			});
			conditions.push(
				`${ident(f.column)} ${f.op} (${placeholders.join(", ")})`,
			);
		} else if (f.isLike) {
			params.push(f.value);
			conditions.push(
				`${ident(f.column)} ILIKE '%' || $${params.length} || '%'`,
			);
		} else {
			params.push(f.value);
			conditions.push(`${ident(f.column)} ${f.op} $${params.length}`);
		}
	}

	if (parsed.search) {
		params.push(parsed.search.value);
		const idx = params.length;
		const orClauses = parsed.search.columns.map(
			(col) => `${ident(col)} ILIKE '%' || $${idx} || '%'`,
		);
		conditions.push(`(${orClauses.join(" OR ")})`);
	}

	return conditions;
}

// ── Aggregate query helpers ──────────────────────────────────────────────

/** Column types eligible for SUM/MIN/MAX. */
const NUMERIC_COLUMN_TYPES = new Set(["uint", "int"]);
/** System columns that are numeric and thus valid SUM/MIN/MAX targets. */
const NUMERIC_SYSTEM_COLUMNS = new Set(["_block_height"]);
/** Cost guard — total agg columns across all functions in one request. */
export const MAX_AGGREGATE_COLUMNS = 32;

/** Parsed aggregate control params (api-internal; mirrors shared SubgraphAggregateParams). */
export interface AggregateControl {
	count?: boolean;
	countDistinct?: string[];
	sum?: string[];
	min?: string[];
	max?: string[];
}

function splitColumns(raw: string): string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Splits the `_count/_countDistinct/_sum/_min/_max` control params out of the
 * query string and validates each referenced column. SUM/MIN/MAX columns must
 * be numeric (uint/int, plus the system `_block_height`). The remaining params
 * are returned untouched as `readParams` for `parseQueryParams` to build the
 * WHERE clause (it throws on any unknown `_`-prefixed key, so the agg params
 * must be stripped first).
 */
export function parseAggregateParams(
	params: Record<string, string>,
	validColumns: Set<string>,
	tableDef: { columns: Record<string, SubgraphColumn> },
): { control: AggregateControl; readParams: Record<string, string> } {
	const control: AggregateControl = {};
	const readParams: Record<string, string> = {};
	let aggColumnCount = 0;

	const requireColumn = (col: string) => {
		if (!validColumns.has(col)) throw new InvalidColumnError(col);
	};
	const requireNumericColumn = (col: string) => {
		requireColumn(col);
		const isNumeric =
			NUMERIC_SYSTEM_COLUMNS.has(col) ||
			NUMERIC_COLUMN_TYPES.has(tableDef.columns[col]?.type ?? "");
		if (!isNumeric) throw new NonNumericColumnError(col);
	};

	for (const [key, value] of Object.entries(params)) {
		if (key === "_count") {
			// Any value except an explicit "false" enables the count.
			control.count = value !== "false";
			continue;
		}
		if (key === "_countDistinct") {
			const cols = splitColumns(value);
			for (const c of cols) requireColumn(c);
			control.countDistinct = cols;
			aggColumnCount += cols.length;
			continue;
		}
		if (key === "_sum") {
			const cols = splitColumns(value);
			for (const c of cols) requireNumericColumn(c);
			control.sum = cols;
			aggColumnCount += cols.length;
			continue;
		}
		if (key === "_min") {
			const cols = splitColumns(value);
			for (const c of cols) requireNumericColumn(c);
			control.min = cols;
			aggColumnCount += cols.length;
			continue;
		}
		if (key === "_max") {
			const cols = splitColumns(value);
			for (const c of cols) requireNumericColumn(c);
			control.max = cols;
			aggColumnCount += cols.length;
			continue;
		}
		readParams[key] = value;
	}

	if (aggColumnCount > MAX_AGGREGATE_COLUMNS) {
		throw new TooManyAggregatesError(aggColumnCount);
	}

	return { control, readParams };
}

/**
 * Builds the SELECT list for an aggregate query. Each column is `ident()`-quoted
 * and aliased `kind__col` (count → `count`, distinct → `cd__`, sum/min/max →
 * `sum__`/`min__`/`max__`). SUM is `COALESCE(…,0)::text` and MIN/MAX `::text` so
 * NUMERIC/BIGINT results round-trip losslessly as strings. Defaults to a bare
 * `COUNT(*)` when no aggregate is requested.
 */
export function buildAggregateSelect(control: AggregateControl): string[] {
	const selects: string[] = [];
	const hasOtherAgg = Boolean(
		control.countDistinct?.length ||
			control.sum?.length ||
			control.min?.length ||
			control.max?.length,
	);
	if (control.count || !hasOtherAgg) {
		selects.push("COUNT(*) AS count");
	}
	for (const c of control.countDistinct ?? []) {
		selects.push(`COUNT(DISTINCT ${ident(c)}) AS "cd__${c}"`);
	}
	for (const c of control.sum ?? []) {
		selects.push(`COALESCE(SUM(${ident(c)}), 0)::text AS "sum__${c}"`);
	}
	for (const c of control.min ?? []) {
		selects.push(`MIN(${ident(c)})::text AS "min__${c}"`);
	}
	for (const c of control.max ?? []) {
		selects.push(`MAX(${ident(c)})::text AS "max__${c}"`);
	}
	return selects;
}
