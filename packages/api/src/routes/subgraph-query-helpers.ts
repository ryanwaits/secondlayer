import type { Subgraph } from "@secondlayer/shared/db";
import { pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";
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

export class InvalidColumnError extends Error {
	constructor(column: string) {
		super(`Unknown column: ${column}`);
	}
}

export interface ParsedQuery {
	filters: { column: string; op: string; value: string; isLike?: boolean }[];
	sort?: string;
	order: "ASC" | "DESC";
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
	let sort: string | undefined;
	let order: "ASC" | "DESC" = "ASC";
	let limit = DEFAULT_LIMIT;
	let offset = 0;
	let fields: string[] | undefined;
	let search: ParsedQuery["search"];

	for (const [key, value] of Object.entries(params)) {
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
			if (!validColumns.has(value)) throw new InvalidColumnError(value);
			sort = value;
			continue;
		}
		if (key === "_order") {
			order = value.toLowerCase() === "desc" ? "DESC" : "ASC";
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
		}

		// Equality filter
		if (!validColumns.has(key)) throw new InvalidColumnError(key);
		filters.push({ column: key, op: "=", value });
	}

	return { filters, sort, order, limit, offset, fields, search };
}

export function buildWhereConditions(
	parsed: ParsedQuery,
	params: unknown[],
): string[] {
	const conditions: string[] = [];

	for (const f of parsed.filters) {
		if (f.isLike) {
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
