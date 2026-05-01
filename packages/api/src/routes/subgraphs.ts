import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BundleSizeError, bundleSubgraphCode } from "@secondlayer/bundler";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb, getRawClient, getSourceDb } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	countSubgraphMissingBlocks,
	findSubgraphGaps,
	getGapSummaryBySubgraph,
} from "@secondlayer/shared/db/queries/subgraph-gaps";
import {
	createSubgraphOperation,
	isActiveSubgraphOperationConflict,
	requestSubgraphOperationCancel,
	requestSubgraphOperationsCancelForDelete,
} from "@secondlayer/shared/db/queries/subgraph-operations";
import {
	getSubgraph,
	listSubgraphs,
	pgSchemaName,
	updateSubgraphStatus,
} from "@secondlayer/shared/db/queries/subgraphs";
import { isPlatformMode } from "@secondlayer/shared/mode";
import {
	DeploySubgraphRequestSchema,
	type SubgraphDetail,
} from "@secondlayer/shared/schemas/subgraphs";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import { Hono } from "hono";
import { sql } from "kysely";
import { getAccountId, getApiKeyId } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { SubgraphRegistryCache } from "../subgraphs/cache.ts";
import {
	InvalidColumnError,
	MAX_LIMIT,
	buildWhereConditions,
	getSubgraphSchema,
	getValidColumns,
	ident,
	parseQueryParams,
	subgraphSchemaName,
} from "./subgraph-query-helpers.ts";

const app = new Hono();

type SubgraphSpecOptions = {
	serverUrl?: string;
	generatedAt?: string;
};

// Resource limits are enforced by Docker compute caps (memory/CPU/storage).
// No application-level count check — if a tenant hits their limits, PG
// simply runs out of resources and we surface it via monitoring.

// Subgraph registry cache — auto-refreshes via PG NOTIFY
export const cache = new SubgraphRegistryCache(async () => {
	const db = getDb();
	return listSubgraphs(db);
});

/** Start the cache listener. Call once on API startup. */
export async function startSubgraphCache(): Promise<void> {
	await cache.start();
}

/** Stop the cache listener. Call on API shutdown. */
export async function stopSubgraphCache(): Promise<void> {
	await cache.stop();
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function query(text: string, params: unknown[] = []) {
	const client = getRawClient();
	// biome-ignore lint/suspicious/noExplicitAny: postgres client requires any[]
	return client.unsafe(text, params as any[]);
}

class SubgraphNotFoundError extends Error {
	code = "SUBGRAPH_NOT_FOUND";
	constructor(subgraphName: string) {
		super(`Subgraph not found: ${subgraphName}`);
		this.name = "SubgraphNotFoundError";
	}
}

type SubgraphSyncSource = {
	status: string;
	start_block: number | string | null;
	last_processed_block: number | string;
	reindex_from_block?: number | string | null;
	reindex_to_block?: number | string | null;
};

function toBlockNumber(
	value: number | string | null | undefined,
): number | null {
	if (value == null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function buildSyncInfo(
	live: SubgraphSyncSource,
	chainTip: number,
	gaps: {
		count: number;
		totalMissingBlocks: number;
		ranges: Array<{
			start: number;
			end: number;
			size: number;
			reason: string;
		}>;
	},
	integrity: "complete" | "gaps_detected",
) {
	const status = live.status;
	const lastProcessedBlock = toBlockNumber(live.last_processed_block) ?? 0;
	const reindexFromBlock = toBlockNumber(live.reindex_from_block);
	const reindexToBlock = toBlockNumber(live.reindex_to_block);
	const isReindexing = status === "reindexing" && reindexToBlock != null;
	const startBlock =
		(isReindexing ? reindexFromBlock : toBlockNumber(live.start_block)) ?? 0;
	const targetBlock = isReindexing ? reindexToBlock : chainTip;
	const totalBlocks = Math.max(0, targetBlock - startBlock + 1);
	const processedBlocks =
		totalBlocks > 0
			? Math.max(0, Math.min(totalBlocks, lastProcessedBlock - startBlock + 1))
			: 0;
	const blocksRemaining = Math.max(0, targetBlock - lastProcessedBlock);
	const progress =
		totalBlocks > 0
			? Number.parseFloat(Math.min(1, processedBlocks / totalBlocks).toFixed(4))
			: 1;

	let syncStatus: "synced" | "catching_up" | "reindexing" | "error";
	if (status === "reindexing") syncStatus = "reindexing";
	else if (status === "error") syncStatus = "error";
	else if (blocksRemaining > 0) syncStatus = "catching_up";
	else syncStatus = "synced";

	return {
		status: syncStatus,
		mode: isReindexing ? "reindex" : "sync",
		startBlock,
		lastProcessedBlock,
		// Backward compatibility: older clients render lastProcessedBlock / chainTip.
		// During reindex, the useful denominator is the reindex target block.
		chainTip: targetBlock,
		sourceChainTip: chainTip,
		targetBlock,
		blocksRemaining,
		processedBlocks,
		totalBlocks,
		progress,
		gaps,
		integrity,
	};
}

async function getChainTip(): Promise<number> {
	const network = process.env.NETWORK ?? "mainnet";
	const selectTip = (db: ReturnType<typeof getDb>) =>
		db
			.selectFrom("index_progress")
			.select(["highest_seen_block", "last_contiguous_block"])
			.where("network", "=", network)
			.executeTakeFirst()
			.catch(() => null);

	const progressRow =
		(await selectTip(getSourceDb()).catch(() => null)) ??
		(await selectTip(getDb()).catch(() => null));
	return progressRow?.highest_seen_block ?? 0;
}

/** Look up a subgraph from cache with account-level ownership check */
function getOwnedSubgraph(
	subgraphName: string,
	accountId: string | undefined,
): Subgraph {
	const subgraph = cache.get(subgraphName, accountId);
	if (!subgraph) {
		throw new SubgraphNotFoundError(subgraphName);
	}
	return subgraph;
}

// ── Deploy a subgraph ───────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? "./data";

export function handlerImportUrl(handlerPath: string, cacheBust = Date.now()) {
	return `${pathToFileURL(resolve(handlerPath)).href}?t=${cacheBust}`;
}

export function applyDeployStartBlockOverride(
	def: SubgraphDefinition,
	startBlock?: number,
): SubgraphDefinition {
	return startBlock === undefined ? def : { ...def, startBlock };
}

export function resolveDeployStartBlock(def: SubgraphDefinition): number {
	return def.startBlock ?? 1;
}

export function hasDeployStartBlockChanged(input: {
	existingStartBlock: number | string | null | undefined;
	definitionStartBlock: number | undefined;
}): boolean {
	return (
		input.definitionStartBlock !== undefined &&
		toBlockNumber(input.existingStartBlock) !== input.definitionStartBlock
	);
}

app.post("/", async (c) => {
	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});

	const parsed = DeploySubgraphRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: parsed.error.flatten().fieldErrors }, 400);
	}

	const { name, handlerCode } = parsed.data;
	const chainTip = await getChainTip();
	if (
		parsed.data.startBlock !== undefined &&
		chainTip > 0 &&
		parsed.data.startBlock > chainTip
	) {
		return c.json(
			{
				error: `startBlock past chain tip: ${parsed.data.startBlock} > ${chainTip}`,
				code: "START_BLOCK_PAST_TIP",
				startBlock: parsed.data.startBlock,
				chainTip,
			},
			400,
		);
	}

	const subgraphsDir = join(DATA_DIR, "subgraphs");
	if (!existsSync(subgraphsDir)) {
		mkdirSync(subgraphsDir, { recursive: true });
	}

	const handlerPath = join(subgraphsDir, `${name}.js`);
	await Bun.write(handlerPath, handlerCode);

	// Import the handler to get a full SubgraphDefinition with handler functions
	let def: SubgraphDefinition;
	try {
		const mod = await import(handlerImportUrl(handlerPath));
		def = applyDeployStartBlockOverride(
			mod.default ?? mod,
			parsed.data.startBlock,
		);
	} catch (err) {
		return c.json(
			{
				error: `Failed to load handler: ${getErrorMessage(err)}`,
			},
			400,
		);
	}

	try {
		const { validateSubgraphDefinition } = await import(
			"@secondlayer/subgraphs/validate"
		);
		validateSubgraphDefinition(def);
	} catch (err) {
		return c.json(
			{
				error: `Invalid subgraph definition: ${getErrorMessage(err)}`,
			},
			400,
		);
	}

	const apiKeyId = getApiKeyId(c);
	const accountId = getAccountId(c);

	const schemaName = pgSchemaName(name);

	const { deploySchema } = await import("@secondlayer/subgraphs");
	const db = getDb();
	const existing = await getSubgraph(db, name, accountId);
	const deployStartBlock = resolveDeployStartBlock(def);
	if (chainTip > 0 && deployStartBlock > chainTip) {
		return c.json(
			{
				error: `startBlock past chain tip: ${deployStartBlock} > ${chainTip}`,
				code: "START_BLOCK_PAST_TIP",
				startBlock: deployStartBlock,
				chainTip,
			},
			400,
		);
	}
	const existingStartBlock = toBlockNumber(existing?.start_block);
	const startBlockChanged =
		existing != null &&
		hasDeployStartBlockChanged({
			existingStartBlock,
			definitionStartBlock: def.startBlock,
		});
	const result = await deploySchema(db, def, handlerPath, {
		apiKeyId,
		accountId,
		schemaName,
		version: parsed.data.version,
		handlerCode: parsed.data.handlerCode,
		sourceCode: parsed.data.sourceCode,
		forceReindex: parsed.data.startBlock !== undefined || startBlockChanged,
	});

	await cache.refresh();

	// Auto-trigger reindex for new deploys and breaking schema changes
	let operationId: string | undefined;
	if (result.action === "created" || result.action === "reindexed") {
		try {
			const operation = await createSubgraphOperation(db, {
				subgraphId: result.subgraphId,
				subgraphName: name,
				accountId,
				kind: "reindex",
				fromBlock: deployStartBlock,
				toBlock: chainTip > 0 ? chainTip : undefined,
			});
			operationId = operation.id;
			await updateSubgraphStatus(db, name, "reindexing");
		} catch (err) {
			if (isActiveSubgraphOperationConflict(err)) {
				return c.json(
					{
						error: `A reindex or backfill is already running for "${name}". Wait for it to complete.`,
						code: "OPERATION_IN_PROGRESS",
					},
					409,
				);
			}
			throw err;
		}
	}

	const status = result.action === "created" ? 201 : 200;
	return c.json(
		{
			action: result.action,
			subgraphId: result.subgraphId,
			version: result.version,
			message: `Subgraph "${name}" ${result.action}`,
			...(result.diff ? { diff: result.diff } : {}),
			...(result.action === "created" || result.action === "reindexed"
				? { reindexStarted: true, operationId }
				: {}),
		},
		status,
	);
});

// ── Bundle (server-side esbuild for chat authoring loop) ─────────────────
//
// Accepts a TypeScript subgraph source and returns the bundled handler +
// extracted metadata. Called by the web chat session proxy so Vercel
// serverless can skip esbuild entirely. CLI/MCP still bundle locally.
// Declared before any `/:subgraphName/...` route so Hono doesn't treat
// "bundle" as a subgraph name.

const VALID_ORIGINS = new Set(["cli", "mcp", "session"]);
function readSubgraphOrigin(c: {
	req: { header(name: string): string | undefined };
}): string {
	const raw = c.req.header("x-sl-origin")?.toLowerCase() ?? "unknown";
	return VALID_ORIGINS.has(raw) ? raw : "unknown";
}

app.post("/bundle", async (c) => {
	const apiKeyId = getApiKeyId(c);
	const accountId = getAccountId(c);
	// Platform mode requires an identity to attribute the bundle to.
	// oss/dedicated modes are single-tenant; no attribution needed.
	if (isPlatformMode() && !apiKeyId && !accountId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const origin = readSubgraphOrigin(c);

	let body: { code?: unknown };
	try {
		body = (await c.req.json()) as { code?: unknown };
	} catch {
		throw new InvalidJSONError();
	}
	if (typeof body.code !== "string" || body.code.length === 0) {
		return c.json({ error: "Missing `code` string in body" }, 400);
	}

	try {
		const bundled = await bundleSubgraphCode(body.code);
		const bundleSize = Buffer.byteLength(bundled.handlerCode, "utf8");
		logger.info("Subgraph bundled", {
			origin,
			name: bundled.name,
			bundleSize,
			ok: true,
		});
		return c.json({
			ok: true,
			name: bundled.name,
			version: bundled.version ?? null,
			description: bundled.description ?? null,
			sources: bundled.sources,
			schema: bundled.schema,
			handlerCode: bundled.handlerCode,
			sourceCode: body.code,
			bundleSize,
		});
	} catch (err) {
		if (err instanceof BundleSizeError) {
			logger.warn("Subgraph bundle rejected: too large", {
				origin,
				actualBytes: err.actualBytes,
				maxBytes: err.maxBytes,
			});
			return c.json(
				{
					ok: false,
					error: err.message,
					code: "BUNDLE_TOO_LARGE",
					actualBytes: err.actualBytes,
					maxBytes: err.maxBytes,
				},
				413,
			);
		}
		const message = err instanceof Error ? err.message : String(err);
		logger.warn("Subgraph bundle failed", { origin, error: message });
		return c.json({ ok: false, error: message, code: "BUNDLE_FAILED" }, 400);
	}
});

// ── Reindex / backfill operations ─────────────────────────────────────

app.post("/:subgraphName/reindex", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const body = await c.req.json().catch(() => ({}));
	const fromBlock =
		typeof body.fromBlock === "number" ? body.fromBlock : undefined;
	const toBlock = typeof body.toBlock === "number" ? body.toBlock : undefined;
	const db = getDb();

	try {
		const operation = await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName,
			accountId,
			kind: "reindex",
			fromBlock,
			toBlock,
		});
		await updateSubgraphStatus(db, subgraphName, "reindexing");

		return c.json({
			message: `Reindex queued for subgraph "${subgraphName}"`,
			fromBlock: fromBlock ?? 1,
			toBlock: toBlock ?? "chain tip",
			operationId: operation.id,
			status: "queued",
		});
	} catch (err) {
		if (isActiveSubgraphOperationConflict(err)) {
			return c.json(
				{
					error: `A reindex or backfill is already running for "${subgraphName}". Wait for it to complete.`,
					code: "OPERATION_IN_PROGRESS",
				},
				409,
			);
		}
		throw err;
	}
});

// ── Stop a running reindex/backfill ──────────────────────────────────

app.post("/:subgraphName/stop", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const db = getDb();
	const operation = await requestSubgraphOperationCancel(db, subgraph.id);
	if (!operation) {
		return c.json(
			{
				error: `No active operation found for "${subgraphName}"`,
				code: "NO_OPERATION",
			},
			404,
		);
	}

	return c.json({
		message: `Stop requested for "${subgraphName}"`,
		operationId: operation.id,
		status: "cancel_requested",
	});
});

// ── Backfill a subgraph (non-destructive) ────────────────────────────────

app.post("/:subgraphName/backfill", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const body = await c.req.json().catch(() => ({}));
	const fromBlock =
		typeof body.fromBlock === "number" ? body.fromBlock : undefined;
	const toBlock = typeof body.toBlock === "number" ? body.toBlock : undefined;

	if (!fromBlock || !toBlock) {
		return c.json(
			{
				error: "Both fromBlock and toBlock are required for backfill",
				code: "VALIDATION_ERROR",
			},
			400,
		);
	}
	const db = getDb();

	try {
		const operation = await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName,
			accountId,
			kind: "backfill",
			fromBlock,
			toBlock,
		});

		return c.json({
			message: `Backfill queued for subgraph "${subgraphName}"`,
			fromBlock,
			toBlock,
			operationId: operation.id,
			status: "queued",
		});
	} catch (err) {
		if (isActiveSubgraphOperationConflict(err)) {
			return c.json(
				{
					error: `A reindex or backfill is already running for "${subgraphName}". Wait for it to complete.`,
					code: "OPERATION_IN_PROGRESS",
				},
				409,
			);
		}
		throw err;
	}
});

// ── Delete a subgraph ────────────────────────────────────────────────────

app.delete("/:subgraphName", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);
	const force = c.req.query("force") === "true";

	const db = getDb();
	const sn = subgraphSchemaName(subgraph);
	const cancelledOperations = await requestSubgraphOperationsCancelForDelete(
		db,
		subgraph.id,
	);
	if (cancelledOperations.length > 0) {
		logger.info("Cancelled subgraph operations before delete", {
			subgraph: subgraphName,
			count: cancelledOperations.length,
			force,
		});
	}

	// Drop the subgraph's schema (all tables) and remove registry entry
	const client = getRawClient();
	await client.unsafe(`DROP SCHEMA IF EXISTS ${ident(sn)} CASCADE`);
	const { deleteSubgraph } = await import(
		"@secondlayer/shared/db/queries/subgraphs"
	);
	await deleteSubgraph(db, subgraphName, accountId);

	// Clean up handler file if it exists
	if (subgraph.handler_path) {
		try {
			unlinkSync(subgraph.handler_path);
		} catch {}
	}

	// Refresh cache
	await cache.refresh();

	return c.json({ message: `Subgraph "${subgraphName}" deleted` });
});

// ── List all subgraphs ──────────────────────────────────────────────────

app.get("/", async (c) => {
	const accountId = getAccountId(c);
	const allSubgraphs = cache.getAll(accountId);

	// Fetch live stats, chain tip, and gap summaries in parallel
	const db = getDb();
	const [liveResult, chainTip, gapSummaries] = await Promise.all([
		db
			.selectFrom("subgraphs")
			.select([
				"id",
				"start_block",
				"last_processed_block",
				"total_processed",
				"total_errors",
				"status",
				"reindex_from_block",
				"reindex_to_block",
			])
			.execute()
			// biome-ignore lint/suspicious/noExplicitAny: fallback empty array
			.catch(() => [] as any[]),
		getChainTip(),
		getGapSummaryBySubgraph(db).catch(() => []),
	]);

	const liveStats = new Map<string, (typeof liveResult)[0]>();
	for (const r of liveResult) liveStats.set(r.id, r);

	const gapMap = new Map<
		string,
		{ gapCount: number; totalMissingBlocks: number }
	>();
	for (const g of gapSummaries) gapMap.set(g.subgraphName, g);

	// Approximate row counts per subgraph schema (single pg_stat query)
	const rowCountMap = new Map<string, number>();
	try {
		const { rows } = await sql
			.raw(
				`SELECT schemaname, SUM(n_live_tup)::bigint AS total_rows FROM pg_stat_user_tables WHERE schemaname LIKE 'subgraph_%' GROUP BY schemaname`,
			)
			.execute(db);
		for (const r of rows as { schemaname: string; total_rows: string }[]) {
			rowCountMap.set(r.schemaname, Number(r.total_rows));
		}
	} catch {}

	return c.json({
		data: allSubgraphs.map((v) => {
			const live = liveStats.get(v.id);
			const gaps = gapMap.get(v.name);
			const sync = buildSyncInfo(
				live ?? v,
				chainTip,
				{
					count: gaps?.gapCount ?? 0,
					totalMissingBlocks: gaps?.totalMissingBlocks ?? 0,
					ranges: [],
				},
				(gaps?.gapCount ?? 0) > 0 ? "gaps_detected" : "complete",
			);

			return {
				name: v.name,
				version: v.version,
				status: live?.status ?? v.status,
				lastProcessedBlock: sync.lastProcessedBlock,
				totalProcessed: live?.total_processed ?? v.total_processed,
				totalRows: rowCountMap.get(subgraphSchemaName(v)) ?? 0,
				totalErrors: live?.total_errors ?? v.total_errors,
				tables: Object.keys(getSubgraphSchema(v)),
				chainTip: sync.chainTip,
				sourceChainTip: sync.sourceChainTip,
				targetBlock: sync.targetBlock,
				progress: sync.progress,
				blocksRemaining: sync.blocksRemaining,
				syncMode: sync.mode,
				gapCount: gaps?.gapCount ?? 0,
				integrity: (gaps?.gapCount ?? 0) > 0 ? "gaps_detected" : "complete",
				createdAt: v.created_at.toISOString(),
			};
		}),
	});
});

// ── Subgraph metadata + docs ────────────────────────────────────────────

async function buildSubgraphDetailPayload(
	subgraphName: string,
	accountId: string | undefined,
): Promise<SubgraphDetail> {
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const subgraphSchema = getSubgraphSchema(subgraph);
	const tables: SubgraphDetail["tables"] = {};
	const sn = subgraphSchemaName(subgraph);

	const schemaEntries = Object.entries(subgraphSchema);
	const db = getDb();
	const [countResults, liveRow, chainTip, gapResult] = await Promise.all([
		Promise.allSettled(
			schemaEntries.map(([tableName]) =>
				query(
					`SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`,
				).then((r) => Number.parseInt(String(r[0]?.count ?? 0), 10)),
			),
		),
		db
			.selectFrom("subgraphs")
			.select([
				"start_block",
				"last_processed_block",
				"total_processed",
				"total_errors",
				"status",
				"last_error",
				"last_error_at",
				"updated_at",
				"reindex_from_block",
				"reindex_to_block",
			])
			.where("id", "=", subgraph.id)
			.executeTakeFirst()
			.catch(() => null),
		getChainTip(),
		findSubgraphGaps(db, subgraphName, {
			limit: 10,
			unresolvedOnly: true,
		}).catch(() => ({ gaps: [], total: 0 })),
	]);

	for (let i = 0; i < schemaEntries.length; i++) {
		const [tableName, tableDef] = schemaEntries[i];
		const cr = countResults[i];
		const rowCount = cr.status === "fulfilled" ? cr.value : 0;
		const columns: SubgraphDetail["tables"][string]["columns"] = {};
		for (const [colName, col] of Object.entries(tableDef.columns)) {
			columns[colName] = {
				type: col.type,
				...(col.nullable && { nullable: true }),
				...(col.indexed && { indexed: true }),
				...(col.search && { searchable: true }),
				...(col.default !== undefined && { default: col.default }),
			};
		}
		columns._id = { type: "serial" };
		columns._block_height = { type: "bigint" };
		columns._tx_id = { type: "text" };
		columns._created_at = { type: "timestamp" };

		tables[tableName] = {
			endpoint: `/subgraphs/${subgraphName}/${tableName}`,
			columns,
			rowCount,
			example: `/subgraphs/${subgraphName}/${tableName}?_sort=_block_height&_order=desc&_limit=10`,
			...(tableDef.indexes && { indexes: tableDef.indexes }),
			...(tableDef.uniqueKeys && { uniqueKeys: tableDef.uniqueKeys }),
		};
	}

	const live = liveRow ?? subgraph;
	const totalProcessed = live.total_processed;
	const totalErrors = live.total_errors;
	const errorRate = totalProcessed > 0 ? totalErrors / totalProcessed : 0;
	const totalMissingBlocks = gapResult.gaps.reduce((sum, g) => sum + g.size, 0);
	const hasGaps = gapResult.total > 0;
	const sync = buildSyncInfo(
		live,
		chainTip,
		{
			count: gapResult.total,
			totalMissingBlocks,
			ranges: gapResult.gaps.map((g) => ({
				start: g.gapStart,
				end: g.gapEnd,
				size: g.size,
				reason: g.reason,
			})),
		},
		hasGaps ? "gaps_detected" : "complete",
	) as SubgraphDetail["sync"];

	const def = subgraph.definition as Record<string, unknown> | null;
	const sources = def?.sources as Record<string, unknown> | undefined;
	const description =
		typeof def?.description === "string" ? def.description : undefined;

	return {
		name: subgraph.name,
		version: subgraph.version,
		schemaHash: subgraph.schema_hash,
		status: live.status,
		lastProcessedBlock: sync.lastProcessedBlock,
		...(description && { description }),
		...(sources && { sources }),
		...(def && { definition: def }),
		health: {
			totalProcessed,
			totalErrors,
			errorRate: Number.parseFloat(errorRate.toFixed(4)),
			lastError: live.last_error ?? null,
			lastErrorAt: live.last_error_at?.toISOString() ?? null,
		},
		sync,
		tables,
		createdAt: subgraph.created_at.toISOString(),
		updatedAt:
			live.updated_at?.toISOString() ?? subgraph.updated_at.toISOString(),
	};
}

function readSpecOptions(c: {
	req: { url: string; query(name: string): string | undefined };
}): SubgraphSpecOptions {
	const server = c.req.query("server");
	return {
		serverUrl: server || new URL(c.req.url).origin,
	};
}

app.get("/:subgraphName/openapi.json", async (c) => {
	const { subgraphName } = c.req.param();
	const detail = await buildSubgraphDetailPayload(
		subgraphName,
		getAccountId(c),
	);
	const { generateSubgraphOpenApi } = await import(
		"@secondlayer/shared/subgraphs/spec"
	);
	return c.json(generateSubgraphOpenApi(detail, readSpecOptions(c)));
});

app.get("/:subgraphName/schema.json", async (c) => {
	const { subgraphName } = c.req.param();
	const detail = await buildSubgraphDetailPayload(
		subgraphName,
		getAccountId(c),
	);
	const { generateSubgraphAgentSchema } = await import(
		"@secondlayer/shared/subgraphs/spec"
	);
	return c.json(generateSubgraphAgentSchema(detail, readSpecOptions(c)));
});

app.get("/:subgraphName/docs.md", async (c) => {
	const { subgraphName } = c.req.param();
	const detail = await buildSubgraphDetailPayload(
		subgraphName,
		getAccountId(c),
	);
	const { generateSubgraphMarkdown } = await import(
		"@secondlayer/shared/subgraphs/spec"
	);
	const markdown = generateSubgraphMarkdown(detail, readSpecOptions(c));
	return c.text(markdown, 200, {
		"Content-Type": "text/markdown; charset=utf-8",
	});
});

app.get("/:subgraphName", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const subgraphSchema = getSubgraphSchema(subgraph);
	// biome-ignore lint/suspicious/noExplicitAny: dynamic schema shape
	const tables: Record<string, any> = {};
	const sn = subgraphSchemaName(subgraph);

	const schemaEntries = Object.entries(subgraphSchema);

	// Fetch live stats, COUNT queries, chain tip, and gaps in parallel
	const db = getDb();
	const [countResults, liveRow, chainTip, gapResult] = await Promise.all([
		Promise.allSettled(
			schemaEntries.map(([tableName]) =>
				query(
					`SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`,
				).then((r) => Number.parseInt(String(r[0]?.count ?? 0), 10)),
			),
		),
		db
			.selectFrom("subgraphs")
			.select([
				"start_block",
				"last_processed_block",
				"total_processed",
				"total_errors",
				"status",
				"last_error",
				"last_error_at",
				"updated_at",
				"reindex_from_block",
				"reindex_to_block",
			])
			.where("id", "=", subgraph.id)
			.executeTakeFirst()
			.catch(() => null),
		getChainTip(),
		findSubgraphGaps(db, subgraphName, {
			limit: 10,
			unresolvedOnly: true,
		}).catch(() => ({ gaps: [], total: 0 })),
	]);

	for (let i = 0; i < schemaEntries.length; i++) {
		const [tableName, tableDef] = schemaEntries[i];
		const cr = countResults[i];
		const rowCount = cr.status === "fulfilled" ? cr.value : 0;

		// biome-ignore lint/suspicious/noExplicitAny: dynamic column shape
		const columns: Record<string, any> = {};
		for (const [colName, col] of Object.entries(tableDef.columns)) {
			columns[colName] = {
				type: col.type,
				...(col.nullable && { nullable: true }),
				...(col.indexed && { indexed: true }),
				...(col.search && { searchable: true }),
				...(col.default !== undefined && { default: col.default }),
			};
		}
		columns._id = { type: "serial" };
		columns._block_height = { type: "bigint" };
		columns._tx_id = { type: "text" };
		columns._created_at = { type: "timestamp" };

		tables[tableName] = {
			endpoint: `/subgraphs/${subgraphName}/${tableName}`,
			columns,
			rowCount,
			example: `/subgraphs/${subgraphName}/${tableName}?_sort=_block_height&_order=desc&_limit=10`,
			...(tableDef.indexes && { indexes: tableDef.indexes }),
			...(tableDef.uniqueKeys && { uniqueKeys: tableDef.uniqueKeys }),
		};
	}

	// Use live DB values for stats, fall back to cache
	const live = liveRow ?? subgraph;
	const totalProcessed = live.total_processed;
	const totalErrors = live.total_errors;
	const errorRate = totalProcessed > 0 ? totalErrors / totalProcessed : 0;

	// Build sync object
	const totalMissingBlocks = gapResult.gaps.reduce((sum, g) => sum + g.size, 0);
	const hasGaps = gapResult.total > 0;
	const sync = buildSyncInfo(
		live,
		chainTip,
		{
			count: gapResult.total,
			totalMissingBlocks,
			ranges: gapResult.gaps.map((g) => ({
				start: g.gapStart,
				end: g.gapEnd,
				size: g.size,
				reason: g.reason,
			})),
		},
		hasGaps ? "gaps_detected" : "complete",
	);

	const def = subgraph.definition as Record<string, unknown> | null;
	const sources = def?.sources ?? null;
	const description = def?.description ?? null;

	return c.json({
		name: subgraph.name,
		version: subgraph.version,
		schemaHash: subgraph.schema_hash,
		status: live.status,
		lastProcessedBlock: sync.lastProcessedBlock,
		...(description && { description }),
		...(sources && { sources }),
		definition: def,
		health: {
			totalProcessed,
			totalErrors,
			errorRate: Number.parseFloat(errorRate.toFixed(4)),
			lastError: live.last_error ?? null,
			lastErrorAt: live.last_error_at?.toISOString() ?? null,
		},
		sync,
		tables,
		createdAt: subgraph.created_at.toISOString(),
		updatedAt:
			live.updated_at?.toISOString() ?? subgraph.updated_at.toISOString(),
	});
});

// ── Get source (for chat read/edit loop) ───────────────────────────────

app.get("/:subgraphName/source", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const db = getDb();
	const row = await db
		.selectFrom("subgraphs")
		.select(["source_code", "updated_at"])
		.where("id", "=", subgraph.id)
		.executeTakeFirst();

	if (!row || row.source_code === null) {
		return c.json({
			name: subgraph.name,
			version: subgraph.version,
			sourceCode: null,
			readOnly: true,
			reason: "deployed before source-capture — redeploy to enable chat edits",
			updatedAt: (row?.updated_at ?? subgraph.updated_at).toISOString(),
		});
	}

	return c.json({
		name: subgraph.name,
		version: subgraph.version,
		sourceCode: row.source_code,
		readOnly: false,
		updatedAt: row.updated_at.toISOString(),
	});
});

// ── Subgraph gaps ──────────────────────────────────────────────────────

app.get("/:subgraphName/gaps", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	getOwnedSubgraph(subgraphName, accountId);

	const db = getDb();
	const params = c.req.query();
	const limit = Math.min(
		Math.max(1, Number.parseInt(params._limit ?? "50", 10) || 50),
		MAX_LIMIT,
	);
	const offset = Math.max(0, Number.parseInt(params._offset ?? "0", 10) || 0);
	const resolvedParam = params.resolved;
	const unresolvedOnly =
		resolvedParam === "true" ? false : resolvedParam !== "all";

	const [result, totalMissing] = await Promise.all([
		findSubgraphGaps(db, subgraphName, {
			limit,
			offset,
			unresolvedOnly: resolvedParam === "all" ? false : unresolvedOnly,
		}),
		countSubgraphMissingBlocks(db, subgraphName),
	]);

	return c.json({
		data: result.gaps.map((g) => ({
			start: g.gapStart,
			end: g.gapEnd,
			size: g.size,
			reason: g.reason,
			detectedAt: g.detectedAt.toISOString(),
			resolvedAt: g.resolvedAt?.toISOString() ?? null,
		})),
		meta: {
			total: result.total,
			totalMissingBlocks: totalMissing,
			limit,
			offset,
		},
	});
});

// ── Count rows ──────────────────────────────────────────────────────────

app.get("/:subgraphName/:tableName/count", async (c) => {
	const { subgraphName, tableName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const subgraphSchema = getSubgraphSchema(subgraph);
	const tableDef = subgraphSchema[tableName];
	if (!tableDef) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}

	const validColumns = getValidColumns(tableDef);

	try {
		const parsed = parseQueryParams(c.req.query(), validColumns, tableDef);
		const sn = subgraphSchemaName(subgraph);
		const params: unknown[] = [];
		let text = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;

		const conditions = buildWhereConditions(parsed, params);
		if (conditions.length > 0) {
			text += ` WHERE ${conditions.join(" AND ")}`;
		}

		const result = await query(text, params);
		return c.json({
			count: Number.parseInt(String(result[0]?.count ?? 0), 10),
		});
	} catch (e) {
		if (e instanceof InvalidColumnError) {
			return c.json({ error: e.message, code: "INVALID_COLUMN" }, 400);
		}
		throw e;
	}
});

// ── Get row by ID ───────────────────────────────────────────────────────

app.get("/:subgraphName/:tableName/:id", async (c) => {
	const { subgraphName, tableName, id } = c.req.param();
	if (id === "count") return;

	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const subgraphSchema = getSubgraphSchema(subgraph);
	if (!subgraphSchema[tableName]) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}

	const sn = subgraphSchemaName(subgraph);
	const result = await query(
		`SELECT * FROM ${ident(sn)}.${ident(tableName)} WHERE "_id" = $1`,
		[Number.parseInt(id, 10)],
	);

	if (!result[0]) {
		return c.json({ error: "Row not found", code: "ROW_NOT_FOUND" }, 404);
	}

	return c.json({ data: result[0] });
});

// ── List rows with filters ──────────────────────────────────────────────

app.get("/:subgraphName/:tableName", async (c) => {
	const { subgraphName, tableName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const subgraphSchema = getSubgraphSchema(subgraph);
	const tableDef = subgraphSchema[tableName];
	if (!tableDef) {
		return c.json({ error: "Table not found", code: "TABLE_NOT_FOUND" }, 404);
	}

	const validColumns = getValidColumns(tableDef);

	try {
		const parsed = parseQueryParams(c.req.query(), validColumns, tableDef);
		const sn = subgraphSchemaName(subgraph);
		const params: unknown[] = [];

		const selectFields = parsed.fields
			? parsed.fields.map((f) => ident(f)).join(", ")
			: "*";

		let text = `SELECT ${selectFields} FROM ${ident(sn)}.${ident(tableName)}`;

		const conditions = buildWhereConditions(parsed, params);
		if (conditions.length > 0) {
			text += ` WHERE ${conditions.join(" AND ")}`;
		}

		const sortCol = parsed.sort ? ident(parsed.sort) : '"_id"';
		text += ` ORDER BY ${sortCol} ${parsed.order}`;
		text += ` LIMIT ${parsed.limit} OFFSET ${parsed.offset}`;

		// Count query uses same params
		let countText = `SELECT COUNT(*) as count FROM ${ident(sn)}.${ident(tableName)}`;
		if (conditions.length > 0) {
			// Rebuild conditions with fresh params array for count query
			const countParams: unknown[] = [];
			const countConditions = buildWhereConditions(parsed, countParams);
			countText += ` WHERE ${countConditions.join(" AND ")}`;
			// Use countParams for count query
			const [data, countResult] = await Promise.all([
				query(text, params),
				query(countText, countParams),
			]);

			return c.json({
				data: Array.from(data),
				meta: {
					total: Number.parseInt(String(countResult[0]?.count ?? 0), 10),
					limit: parsed.limit,
					offset: parsed.offset,
				},
			});
		}

		const [data, countResult] = await Promise.all([
			query(text, params),
			query(countText),
		]);

		return c.json({
			data: Array.from(data),
			meta: {
				total: Number.parseInt(String(countResult[0]?.count ?? 0), 10),
				limit: parsed.limit,
				offset: parsed.offset,
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
