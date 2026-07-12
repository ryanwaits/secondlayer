import type { Subgraph } from "@secondlayer/shared/db";
import { resolveSubgraphRawClient } from "@secondlayer/shared/db/queries/subgraphs";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
	InvalidColumnError,
	NonNumericColumnError,
	TooManyAggregatesError,
	buildAggregateSelect,
	buildWhereConditions,
	getSubgraphSchema,
	getValidColumns,
	ident,
	parseAggregateParams,
	parseQueryParams,
	subgraphSchemaName,
} from "../routes/subgraph-query-helpers.ts";

// Read primitives shared by the authed /api/subgraphs surface and the open
// /v1/subgraphs surface. Each handler takes an already-resolved subgraph —
// ownership/visibility resolution is the caller's concern, never this layer's.

export class SubgraphNotFoundError extends Error {
	code = "SUBGRAPH_NOT_FOUND";
	constructor(subgraphName: string) {
		super(`Subgraph not found: ${subgraphName}`);
		this.name = "SubgraphNotFoundError";
	}
}

// Serving reads route to the subgraph's data plane: the user's DB for BYO, else
// the managed target. resolveSubgraphRawClient handles both (cached by URL).
export async function querySubgraph(
	subgraph: Subgraph,
	text: string,
	params: unknown[] = [],
) {
	const client = resolveSubgraphRawClient(subgraph);
	// biome-ignore lint/suspicious/noExplicitAny: postgres client requires any[]
	return client.unsafe(text, params as any[]);
}

// `_count` controls how the count is computed: "exact" (default, unchanged)
// runs COUNT(*); "estimate" uses pg_class.reltuples (no table scan) when there
// are no filters — filtered requests fall back to "exact" since a planner
// estimate wouldn't reflect the WHERE clause. Mirrors the list endpoint's
// `_count` handling in routes/subgraphs.ts.
const COUNT_MODES = new Set(["exact", "estimate"]);

export async function handleTableCount(
	c: Context,
	subgraph: Subgraph,
	tableName: string,
): Promise<Response> {
	const tableDef = getSubgraphSchema(subgraph)[tableName];
	if (!tableDef) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}
	const validColumns = getValidColumns(tableDef);

	const countModeRaw = c.req.query("_count");
	if (countModeRaw !== undefined && !COUNT_MODES.has(countModeRaw)) {
		return c.json(
			{
				error: `Invalid _count value: "${countModeRaw}". Expected "exact" or "estimate".`,
				code: "VALIDATION_ERROR",
			},
			400,
		);
	}
	const countMode = (countModeRaw ?? "exact") as "exact" | "estimate";

	try {
		// Strip `_count` before parseQueryParams — it throws on any unrecognized
		// `_`-prefixed key.
		const { _count: _countParam, ...queryParams } = c.req.query();
		const parsed = parseQueryParams(queryParams, validColumns, tableDef);
		const sn = subgraphSchemaName(subgraph);
		const params: unknown[] = [];

		const conditions = buildWhereConditions(parsed, params);

		if (countMode === "estimate" && conditions.length === 0) {
			const qualifiedName = `${ident(sn)}.${ident(tableName)}`;
			const result = await querySubgraph(
				subgraph,
				"SELECT reltuples::bigint AS count FROM pg_class WHERE oid = $1::regclass",
				[qualifiedName],
			);
			return c.json({
				count: Number.parseInt(String(result[0]?.count ?? 0), 10),
			});
		}

		let text = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;
		if (conditions.length > 0) {
			text += ` WHERE ${conditions.join(" AND ")}`;
		}

		const result = await querySubgraph(subgraph, text, params);
		return c.json({
			count: Number.parseInt(String(result[0]?.count ?? 0), 10),
		});
	} catch (e) {
		if (e instanceof InvalidColumnError) {
			return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
		}
		throw e;
	}
}

export async function handleTableAggregate(
	c: Context,
	subgraph: Subgraph,
	tableName: string,
): Promise<Response> {
	const tableDef = getSubgraphSchema(subgraph)[tableName];
	if (!tableDef) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}
	const validColumns = getValidColumns(tableDef);

	try {
		// Strip agg control params before parseQueryParams (it throws on any
		// unknown `_`-prefixed key), then parse the remainder as WHERE filters.
		const { control, readParams } = parseAggregateParams(
			c.req.query(),
			validColumns,
			tableDef,
		);
		const parsed = parseQueryParams(readParams, validColumns, tableDef);
		const sn = subgraphSchemaName(subgraph);
		const params: unknown[] = [];

		const conditions = buildWhereConditions(parsed, params);
		let text = `SELECT ${buildAggregateSelect(control).join(", ")} FROM ${ident(sn)}.${ident(tableName)}`;
		if (conditions.length > 0) {
			text += ` WHERE ${conditions.join(" AND ")}`;
		}

		const result = await querySubgraph(subgraph, text, params);
		const row = (result[0] ?? {}) as Record<string, string | number | null>;

		// Reshape the single result row from `kind__col` aliases into the grouped
		// response. count/countDistinct → numbers; sum/min/max → lossless strings.
		const response: {
			count?: number;
			countDistinct?: Record<string, number>;
			sum?: Record<string, string>;
			min?: Record<string, string | null>;
			max?: Record<string, string | null>;
		} = {};
		const countDistinct: Record<string, number> = {};
		const sum: Record<string, string> = {};
		const min: Record<string, string | null> = {};
		const max: Record<string, string | null> = {};
		for (const [alias, value] of Object.entries(row)) {
			if (alias === "count") {
				response.count = Number.parseInt(String(value ?? 0), 10);
			} else if (alias.startsWith("cd__")) {
				countDistinct[alias.slice(4)] = Number.parseInt(String(value ?? 0), 10);
			} else if (alias.startsWith("sum__")) {
				sum[alias.slice(5)] = String(value ?? "0");
			} else if (alias.startsWith("min__")) {
				min[alias.slice(5)] = value == null ? null : String(value);
			} else if (alias.startsWith("max__")) {
				max[alias.slice(5)] = value == null ? null : String(value);
			}
		}
		if (Object.keys(countDistinct).length > 0)
			response.countDistinct = countDistinct;
		if (Object.keys(sum).length > 0) response.sum = sum;
		if (Object.keys(min).length > 0) response.min = min;
		if (Object.keys(max).length > 0) response.max = max;

		return c.json(response);
	} catch (e) {
		if (e instanceof NonNumericColumnError) {
			return c.json({ error: e.message, code: "NON_NUMERIC_COLUMN" }, 400);
		}
		if (e instanceof TooManyAggregatesError) {
			return c.json({ error: e.message, code: "TOO_MANY_AGGREGATES" }, 400);
		}
		if (e instanceof InvalidColumnError) {
			return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
		}
		throw e;
	}
}

export async function handleRowById(
	c: Context,
	subgraph: Subgraph,
	tableName: string,
	id: string,
): Promise<Response> {
	if (!getSubgraphSchema(subgraph)[tableName]) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}

	const numericId = Number(id);
	if (!Number.isInteger(numericId)) {
		return c.json({ error: "Row not found", code: "ROW_NOT_FOUND" }, 404);
	}

	const sn = subgraphSchemaName(subgraph);
	const result = await querySubgraph(
		subgraph,
		`SELECT * FROM ${ident(sn)}.${ident(tableName)} WHERE "_id" = $1`,
		[numericId],
	);

	if (!result[0]) {
		return c.json({ error: "Row not found", code: "ROW_NOT_FOUND" }, 404);
	}

	return c.json({ data: result[0] });
}

/**
 * SSE: stream rows as they're indexed. Poll-based — tails the table by a
 * monotonic `_id` cursor every ~1.5s and pushes each new row as an SSE message;
 * reuses the same filter query params as the REST list endpoints. Go-forward by
 * default; `?since=<block>` replays from a block then tails. No subscription
 * record is created — this is ephemeral.
 */
export function handleTableStream(
	c: Context,
	subgraph: Subgraph,
	tableName: string,
): Response {
	const tableDef = getSubgraphSchema(subgraph)[tableName];
	if (!tableDef) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}
	const validColumns = getValidColumns(tableDef);
	// `since` is SSE-specific — strip it before parsing the rest as column
	// filters (parseQueryParams treats unknown keys as filters).
	const { since: sinceRaw, ...filterQuery } = c.req.query();
	let parsed: ReturnType<typeof parseQueryParams>;
	try {
		parsed = parseQueryParams(filterQuery, validColumns, tableDef);
	} catch (e) {
		if (e instanceof InvalidColumnError) {
			return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
		}
		throw e;
	}
	const sn = subgraphSchemaName(subgraph);
	const tbl = `${ident(sn)}.${ident(tableName)}`;
	const since =
		sinceRaw != null && Number.isFinite(Number(sinceRaw))
			? Number(sinceRaw)
			: null;

	return streamSSE(c, async (stream) => {
		// Seed the keyset cursor. No `since` → tail from the current max _id.
		// With `?since`, seed from MIN(_id) at/after that block height so we jump
		// straight to the replay window instead of scanning from _id=0 on every
		// poll. The in-loop `_block_height >= since` filter stays as a correctness
		// guard (reorg reprocessing can insert a lower-height row at a higher _id).
		let cursor = 0;
		if (since == null) {
			const r = await querySubgraph(
				subgraph,
				`SELECT COALESCE(MAX("_id"), 0) AS m FROM ${tbl}`,
			);
			cursor = Number((r[0] as { m?: number | string })?.m ?? 0);
		} else {
			const r = await querySubgraph(
				subgraph,
				`SELECT MIN("_id") AS m FROM ${tbl} WHERE "_block_height" >= $1`,
				[since],
			);
			const minId = (r[0] as { m?: number | string | null })?.m;
			if (minId != null) {
				// First matching row is _id = minId; `_id > cursor` includes it.
				cursor = Number(minId) - 1;
			} else {
				// Nothing at/after `since` yet — tail live from the current tip.
				const max = await querySubgraph(
					subgraph,
					`SELECT COALESCE(MAX("_id"), 0) AS m FROM ${tbl}`,
				);
				cursor = Number((max[0] as { m?: number | string })?.m ?? 0);
			}
		}
		let lastBeat = Date.now();
		while (!stream.aborted) {
			const params: unknown[] = [];
			const conds = buildWhereConditions(parsed, params);
			params.push(cursor);
			conds.push(`"_id" > $${params.length}`);
			if (since != null) {
				params.push(since);
				conds.push(`"_block_height" >= $${params.length}`);
			}
			const text = `SELECT * FROM ${tbl} WHERE ${conds.join(" AND ")} ORDER BY "_id" ASC LIMIT 500`;
			const rows = await querySubgraph(subgraph, text, params);
			for (const row of rows) {
				const r = row as Record<string, unknown>;
				await stream.writeSSE({ data: JSON.stringify(r), id: String(r._id) });
				cursor = Math.max(cursor, Number(r._id));
			}
			if (rows.length > 0) {
				lastBeat = Date.now();
			} else if (Date.now() - lastBeat > 20_000) {
				// Heartbeat (custom event so SDK onmessage ignores it) keeps the
				// connection + any proxies alive during idle stretches.
				await stream.writeSSE({ event: "ping", data: "" });
				lastBeat = Date.now();
			}
			await stream.sleep(1500);
		}
	});
}
