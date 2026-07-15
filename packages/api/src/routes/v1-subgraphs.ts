import { getDb } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	RateLimitError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { sql } from "kysely";
import { getClientIp } from "../auth/http.ts";
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
import { resolveWalletAccount } from "../subgraphs/wallet-account.ts";
import { isX402Enabled } from "../x402/facilitator.ts";
import { x402PaymentRequired } from "../x402/middleware.ts";
import {
	InvalidColumnError,
	buildWhereConditions,
	getSubgraphSchema,
	getValidColumns,
	ident,
	parseQueryParams,
	subgraphSchemaName,
} from "./subgraph-query-helpers.ts";
import {
	buildSubgraphDetailFromRow,
	cache,
	getChainTip,
	readSpecOptions,
	runSubgraphDeploy,
} from "./subgraphs.ts";

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

// ── x402-paid writes (accountless agents) ───────────────────────────────
//
// POST /v1/subgraphs        — pay $2, deploy a subgraph you own by wallet.
// POST /v1/subgraphs/:name/renew — pay $0.50, extend its expiry a week.
//
// Identity is the settled payer principal → one wallet-ghost account per
// principal. Plan 'none' means the genesis clamp keeps these forward-only;
// the 7-day TTL (renewable, cleared on claim) bounds abandoned tables.
// Managed plane only — BYO needs a claimed account.

export const PAID_DEPLOY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PaidDeps = {
	x402DeployMiddleware?: ReturnType<typeof x402PaymentRequired>;
	x402RenewMiddleware?: ReturnType<typeof x402PaymentRequired>;
	deploy?: typeof runSubgraphDeploy;
};

export function registerPaidWriteRoutes(
	router: Hono<V1SubgraphsEnv>,
	deps: PaidDeps = {},
) {
	if (!deps.x402DeployMiddleware && !isX402Enabled()) {
		const body = {
			error:
				"Paid deploys need the x402 rail, which is not enabled on this host. Claim an account to deploy with an API key.",
			code: "PAYMENT_RAIL_UNAVAILABLE",
		};
		router.post("/", (c) => c.json(body, 503));
		router.post("/:subgraphName/renew", (c) => c.json(body, 503));
		return;
	}

	const deployMw =
		deps.x402DeployMiddleware ??
		x402PaymentRequired({ surface: "subgraph-deploy" });
	const renewMw =
		deps.x402RenewMiddleware ??
		x402PaymentRequired({ surface: "subgraph-renew" });
	const deploy = deps.deploy ?? runSubgraphDeploy;

	router.post("/", deployMw, async (c) => {
		const payer = c.get("x402Payer" as never) as string | undefined;
		if (!payer) {
			throw new AuthenticationError("Paid deploy requires a settled payment");
		}
		// Peek the body for BYO — paid deploys are managed-plane only.
		const body = await c.req.raw
			.clone()
			.json()
			.catch(() => ({}));
		if (
			body &&
			typeof body === "object" &&
			"databaseUrl" in body &&
			body.databaseUrl
		) {
			throw new ValidationError(
				"BYO databases need a claimed account — paid deploys run on the managed plane",
			);
		}
		const account = await resolveWalletAccount(getDb(), payer);
		return deploy(c, { accountId: account.id, paidTtlMs: PAID_DEPLOY_TTL_MS });
	});

	router.post("/:subgraphName/renew", renewMw, async (c) => {
		const payer = c.get("x402Payer" as never) as string | undefined;
		if (!payer) {
			throw new AuthenticationError("Renewal requires a settled payment");
		}
		const db = getDb();
		const account = await db
			.selectFrom("accounts")
			.select("id")
			.where("wallet_principal", "=", payer)
			.executeTakeFirst();
		const name = c.req.param("subgraphName");
		const row = account
			? await db
					.selectFrom("subgraphs")
					.select(["name", "expires_at"])
					.where("name", "=", name)
					.where("account_id", "=", account.id)
					.executeTakeFirst()
			: undefined;
		if (!account || !row) {
			throw new SubgraphNotFoundError(name);
		}
		const base = row.expires_at
			? Math.max(new Date(row.expires_at).getTime(), Date.now())
			: Date.now();
		const expiresAt = new Date(base + PAID_DEPLOY_TTL_MS);
		const { updateSubgraphExpiry } = await import(
			"@secondlayer/shared/db/queries/subgraphs"
		);
		await updateSubgraphExpiry(db, name, account.id, expiresAt);
		return c.json({ name, expires_at: expiresAt.toISOString() });
	});
}

registerPaidWriteRoutes(app);

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
		: [`subgraphs:anon:${getClientIp(c)}`, ANON_RATE_LIMIT_PER_SECOND];
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

/**
 * Contract provenance from the definition's source filters: contractId on
 * call/deploy/print filters, the principal half of assetIdentifier
 * ("SP….contract::token") on FT/NFT filters. Directory cards and the
 * "build one like this" scaffold CTA both key off this.
 */
function extractSources(v: Subgraph): string[] {
	const sources = (v.definition as { sources?: Record<string, unknown> })
		.sources;
	if (!sources) return [];
	const out = new Set<string>();
	for (const filter of Object.values(sources)) {
		const f = filter as { contractId?: unknown; assetIdentifier?: unknown };
		if (typeof f.contractId === "string") out.add(f.contractId);
		if (typeof f.assetIdentifier === "string") {
			const principal = f.assetIdentifier.split("::")[0];
			if (principal) out.add(principal);
		}
	}
	return [...out];
}

function summarize(
	v: Subgraph,
	ownedBy: string | undefined,
	chainTip: number,
	rowCounts: Map<string, number>,
) {
	const lastProcessed = Number(v.last_processed_block) || 0;
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
		version: v.version,
		created_at: v.created_at.toISOString(),
		// null for BYO — rows live in the user's DB, pg_stat can't see them.
		total_rows: v.database_url_enc
			? null
			: (rowCounts.get(subgraphSchemaName(v)) ?? 0),
		sources: extractSources(v),
		last_processed_block: lastProcessed,
		blocks_behind: Math.max(0, chainTip - lastProcessed),
		tables: Object.keys(getSubgraphSchema(v)),
		url: `/v1/subgraphs/${v.name}`,
	};
}

/** Approximate per-schema row counts (single pg_stat scan on the managed DB). */
async function getRowCounts(): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	try {
		const { rows } = await sql
			.raw(
				`SELECT schemaname, SUM(n_live_tup)::bigint AS total_rows FROM pg_stat_user_tables WHERE schemaname LIKE 'subgraph_%' GROUP BY schemaname`,
			)
			.execute(getDb());
		for (const r of rows as { schemaname: string; total_rows: string }[]) {
			counts.set(r.schemaname, Number(r.total_rows));
		}
	} catch {}
	return counts;
}

const ANON_DIRECTORY_TTL_MS = 10_000;

let anonDirectoryCache: {
	body: string;
	etag: string;
	computedAt: number;
} | null = null;

export function resetAnonDirectoryCache(): void {
	anonDirectoryCache = null;
}

app.get("/", async (c) => {
	const accountId = c.get("v1AccountId");

	// Anon-cacheable: the keyed view varies on the bearer, so only the anon
	// list advertises caching (the directory is the hot path). Short TTL
	// memoization skips the row-count aggregate + tip lookup + summarize pass
	// (and the ETag hash) on repeat anon hits, including 304 revalidations.
	if (!accountId) {
		const now = Date.now();
		if (
			anonDirectoryCache &&
			now - anonDirectoryCache.computedAt < ANON_DIRECTORY_TTL_MS
		) {
			c.header("Cache-Control", "public, max-age=30");
			c.header("ETag", anonDirectoryCache.etag);
			if (c.req.header("if-none-match") === anonDirectoryCache.etag) {
				return c.body(null, 304);
			}
			c.header("Content-Type", "application/json");
			return c.body(anonDirectoryCache.body, 200);
		}
	}

	const [chainTip, rowCounts] = await Promise.all([
		getChainTip(),
		getRowCounts(),
	]);
	const seen = new Set<string>();
	const out = [];
	if (accountId) {
		for (const v of cache.getAll(accountId)) {
			seen.add(`${v.account_id}:${v.name}`);
			out.push(summarize(v, accountId, chainTip, rowCounts));
		}
	}
	for (const v of cache.getAll()) {
		if (v.visibility !== "public") continue;
		if (seen.has(`${v.account_id}:${v.name}`)) continue;
		out.push(summarize(v, accountId, chainTip, rowCounts));
	}
	const body = {
		subgraphs: out,
		tip: { block_height: chainTip },
		envelope: {
			rows: "GET /v1/subgraphs/:name/:table → { rows, next_cursor, tip }",
			cursor: "_id keyset; pass ?cursor=<next_cursor> to resume",
		},
	};
	if (!accountId) {
		const bodyString = JSON.stringify(body);
		const etag = `"${Bun.hash(bodyString).toString(16)}"`;
		anonDirectoryCache = { body: bodyString, etag, computedAt: Date.now() };
		c.header("Cache-Control", "public, max-age=30");
		c.header("ETag", etag);
		if (c.req.header("if-none-match") === etag) {
			return c.body(null, 304);
		}
	}
	return c.json(body);
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
		created_at: subgraph.created_at.toISOString(),
		sources: extractSources(subgraph),
		start_block: Number(subgraph.start_block) || 0,
		tables: Object.fromEntries(
			Object.entries(schema).map(([table, def]) => {
				const columns = (def as { columns: Record<string, { type?: string }> })
					.columns;
				return [
					table,
					{
						endpoint: `/v1/subgraphs/${subgraph.name}/${table}`,
						columns: Object.keys(columns),
						column_types: Object.fromEntries(
							Object.entries(columns).map(([n, col]) => [
								n,
								col.type ?? "text",
							]),
						),
					},
				];
			}),
		),
		tip: {
			block_height: chainTip,
			subgraph_height: lastProcessed,
			blocks_behind: Math.max(0, chainTip - lastProcessed),
		},
		docs: {
			openapi: `/v1/subgraphs/${subgraph.name}/openapi.json`,
			schema: `/v1/subgraphs/${subgraph.name}/schema.json`,
			markdown: `/v1/subgraphs/${subgraph.name}/docs.md`,
		},
	});
});

// ── Generated docs ──────────────────────────────────────────────────────

// Same generators as /api/subgraphs, but resolved by visibility (anon →
// public only) and passed the detail incl. visibility so public subgraphs
// document the /v1 surface. Registered before /:subgraphName/:tableName so
// the static segments win.

app.get("/:subgraphName/openapi.json", async (c) => {
	const { subgraphName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	const detail = await buildSubgraphDetailFromRow(subgraph);
	const { generateSubgraphOpenApi } = await import(
		"@secondlayer/shared/subgraphs/spec"
	);
	return c.json(generateSubgraphOpenApi(detail, readSpecOptions(c)));
});

app.get("/:subgraphName/schema.json", async (c) => {
	const { subgraphName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	const detail = await buildSubgraphDetailFromRow(subgraph);
	const { generateSubgraphAgentSchema } = await import(
		"@secondlayer/shared/subgraphs/spec"
	);
	return c.json(generateSubgraphAgentSchema(detail, readSpecOptions(c)));
});

app.get("/:subgraphName/docs.md", async (c) => {
	const { subgraphName } = c.req.param();
	const subgraph = resolveReadableSubgraph(subgraphName, c.get("v1AccountId"));
	const detail = await buildSubgraphDetailFromRow(subgraph);
	const { generateSubgraphMarkdown } = await import(
		"@secondlayer/shared/subgraphs/spec"
	);
	return c.text(generateSubgraphMarkdown(detail, readSpecOptions(c)), 200, {
		"Content-Type": "text/markdown; charset=utf-8",
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
