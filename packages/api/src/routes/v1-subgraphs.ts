import { getDb } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	RateLimitError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { hashToken } from "../auth/keys.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import {
	SubgraphNotFoundError,
	handleRowById,
	handleTableAggregate,
	handleTableCount,
	handleTableStream,
	querySubgraph,
} from "../subgraphs/read-core.ts";
import {
	InvalidColumnError,
	buildWhereConditions,
	getSubgraphSchema,
	getValidColumns,
	ident,
	parseQueryParams,
	subgraphSchemaName,
} from "./subgraph-query-helpers.ts";
import { cache, getChainTip } from "./subgraphs.ts";

/**
 * Open read surface for subgraphs: /v1/subgraphs.
 *
 * Posture matches the other /v1 surfaces — wildcard CORS, anon reads allowed,
 * cursor envelope. Resolution rules:
 *   - anon          → public subgraphs only; private names 404 (no existence leak)
 *   - sk-sl_ bearer → the key's account's subgraphs (public or private) first,
 *                     then any public subgraph
 *
 * The authed /api/subgraphs surface (dashboard, deploys, ops) is unchanged.
 */

type V1SubgraphsEnv = {
	Variables: {
		v1AccountId?: string;
	};
};

const app = new Hono<V1SubgraphsEnv>();

// ── Auth (optional bearer) ──────────────────────────────────────────────

// Anon is the default; a presented key must be valid (silent fallthrough to
// anon would make private reads "work" with a typo'd key — fail loud instead).
app.use("*", async (c, next) => {
	const authHeader = c.req.header("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		await next();
		return;
	}
	const raw = authHeader.slice(7);
	if (!raw.startsWith("sk-sl_")) {
		throw new AuthenticationError(
			"Use an sk-sl_ API key (session tokens are dashboard-only)",
		);
	}
	const key = await getDb()
		.selectFrom("api_keys")
		.select(["account_id", "status"])
		.where("key_hash", "=", hashToken(raw))
		.executeTakeFirst();
	if (!key || key.status !== "active") {
		throw new AuthenticationError("Invalid API key");
	}
	c.set("v1AccountId", key.account_id);
	await next();
});

// ── Rate limit ──────────────────────────────────────────────────────────

const ANON_RATE_LIMIT_PER_SECOND = 100;
const KEYED_RATE_LIMIT_PER_SECOND = 50;
const WINDOW_MS = 1_000;

app.use("*", async (c, next) => {
	const accountId = c.get("v1AccountId");
	const [bucket, limit] = accountId
		? [`subgraphs:${accountId}`, KEYED_RATE_LIMIT_PER_SECOND]
		: ["subgraphs:anon", ANON_RATE_LIMIT_PER_SECOND];
	const result = await getRateLimitStore().check(bucket, limit, WINDOW_MS);
	c.header("X-RateLimit-Limit", String(limit));
	c.header("X-RateLimit-Remaining", String(Math.max(0, limit - result.count)));
	c.header("X-RateLimit-Reset", String(result.resetAt));
	if (!result.allowed) {
		c.header("Retry-After", String(result.retryAfter));
		throw new RateLimitError("Rate limit exceeded");
	}
	await next();
});

// ── Resolution ──────────────────────────────────────────────────────────

function resolveReadableSubgraph(
	name: string,
	accountId: string | undefined,
): Subgraph {
	if (accountId) {
		const own = cache.get(name, accountId);
		if (own) return own;
	}
	const pub = cache.getPublicByName(name);
	if (pub) return pub;
	throw new SubgraphNotFoundError(name);
}

// ── Discovery ───────────────────────────────────────────────────────────

function summarize(v: Subgraph, ownedBy: string | undefined) {
	return {
		name: v.name,
		description:
			typeof (v.definition as { description?: unknown }).description ===
			"string"
				? ((v.definition as { description: string }).description ?? null)
				: null,
		status: v.status,
		visibility: v.visibility,
		owned: v.account_id === ownedBy,
		last_processed_block: Number(v.last_processed_block) || 0,
		tables: Object.keys(getSubgraphSchema(v)),
		url: `/v1/subgraphs/${v.name}`,
	};
}

app.get("/", (c) => {
	const accountId = c.get("v1AccountId");
	const seen = new Set<string>();
	const out = [];
	if (accountId) {
		for (const v of cache.getAll(accountId)) {
			seen.add(`${v.account_id}:${v.name}`);
			out.push(summarize(v, accountId));
		}
	}
	for (const v of cache.getAll()) {
		if (v.visibility !== "public") continue;
		if (seen.has(`${v.account_id}:${v.name}`)) continue;
		out.push(summarize(v, accountId));
	}
	return c.json({
		subgraphs: out,
		envelope: {
			rows: "GET /v1/subgraphs/:name/:table → { rows, next_cursor, tip }",
			cursor: "_id keyset; pass ?cursor=<next_cursor> to resume",
		},
	});
});

app.get("/:subgraphName", async (c) => {
	const { subgraphName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	const schema = getSubgraphSchema(subgraph);
	const chainTip = await getChainTip();
	const lastProcessed = Number(subgraph.last_processed_block) || 0;
	return c.json({
		name: subgraph.name,
		description:
			typeof (subgraph.definition as { description?: unknown }).description ===
			"string"
				? (subgraph.definition as { description: string }).description
				: null,
		version: subgraph.version,
		status: subgraph.status,
		visibility: subgraph.visibility,
		start_block: Number(subgraph.start_block) || 0,
		tables: Object.fromEntries(
			Object.entries(schema).map(([table, def]) => [
				table,
				{
					endpoint: `/v1/subgraphs/${subgraph.name}/${table}`,
					columns: Object.keys(
						(def as { columns: Record<string, unknown> }).columns,
					),
				},
			]),
		),
		tip: {
			block_height: chainTip,
			subgraph_height: lastProcessed,
			blocks_behind: Math.max(0, chainTip - lastProcessed),
		},
	});
});

// ── Table reads (delegated cores share logic with /api/subgraphs) ───────

app.get("/:subgraphName/:tableName/count", async (c) => {
	const { subgraphName, tableName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	return handleTableCount(c, subgraph, tableName);
});

app.get("/:subgraphName/:tableName/aggregate", async (c) => {
	const { subgraphName, tableName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	return handleTableAggregate(c, subgraph, tableName);
});

app.get("/:subgraphName/:tableName/stream", (c) => {
	const { subgraphName, tableName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	return handleTableStream(c, subgraph, tableName);
});

app.get("/:subgraphName/:tableName/:id", async (c) => {
	const { subgraphName, tableName, id } = c.req.param();
	if (id === "count" || id === "stream" || id === "aggregate") return;
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	return handleRowById(c, subgraph, tableName, id);
});

// ── Cursor-paginated rows ───────────────────────────────────────────────

// /v1 envelope: { rows, next_cursor, tip } with `_id` keyset pagination —
// no offset (deep OFFSET scans hurt on big tables) and no arbitrary sort
// (keyset needs a stable order). Filters/_fields/_limit work as on /api.
app.get("/:subgraphName/:tableName", async (c) => {
	const { subgraphName, tableName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));

	const tableDef = getSubgraphSchema(subgraph)[tableName];
	if (!tableDef) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}
	const validColumns = getValidColumns(tableDef);

	const { cursor: cursorRaw, ...query } = c.req.query();
	if ("_offset" in query || "_sort" in query) {
		throw new ValidationError(
			"/v1 uses cursor pagination ordered by _id: pass ?cursor=<next_cursor> to resume, _order=asc|desc for direction (no _offset/_sort)",
		);
	}

	try {
		const parsed = parseQueryParams(query, validColumns, tableDef);
		const desc = parsed.sorts.some(
			(s) => s.column === "_id" && s.order === "DESC",
		);
		// _order without _sort applies to the implicit _id ordering.
		const order =
			desc || c.req.query("_order")?.toLowerCase() === "desc" ? "DESC" : "ASC";

		const sn = subgraphSchemaName(subgraph);
		const params: unknown[] = [];
		const conditions = buildWhereConditions(parsed, params);

		const cursor =
			cursorRaw != null && /^\d+$/.test(cursorRaw) ? Number(cursorRaw) : null;
		if (cursorRaw != null && cursor == null) {
			throw new ValidationError(`invalid cursor: ${cursorRaw}`);
		}
		if (cursor != null) {
			params.push(cursor);
			conditions.push(`"_id" ${order === "ASC" ? ">" : "<"} $${params.length}`);
		}

		const selectFields = parsed.fields
			? parsed.fields.map((f) => ident(f)).join(", ")
			: "*";
		let text = `SELECT ${selectFields} FROM ${ident(sn)}.${ident(tableName)}`;
		if (conditions.length > 0) text += ` WHERE ${conditions.join(" AND ")}`;
		text += ` ORDER BY "_id" ${order} LIMIT ${parsed.limit}`;

		const [rows, chainTip] = await Promise.all([
			querySubgraph(subgraph, text, params),
			getChainTip(),
		]);

		const lastRow = rows[rows.length - 1] as { _id?: number | string };
		const nextCursor =
			rows.length === parsed.limit && lastRow?._id != null
				? String(lastRow._id)
				: null;
		const lastProcessed = Number(subgraph.last_processed_block) || 0;

		return c.json({
			rows: Array.from(rows),
			next_cursor: nextCursor,
			tip: {
				block_height: chainTip,
				subgraph_height: lastProcessed,
				blocks_behind: Math.max(0, chainTip - lastProcessed),
			},
		});
	} catch (e) {
		if (e instanceof InvalidColumnError) {
			return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
		}
		throw e;
	}
});

export default app;
