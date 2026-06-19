import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BundleSizeError, bundleSubgraphCode } from "@secondlayer/bundler";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb, getRawClientFor, getSourceDb } from "@secondlayer/shared/db";
import type { Subgraph, SubgraphOperation } from "@secondlayer/shared/db";
import {
	countSubgraphMissingBlocks,
	findSubgraphGaps,
	getGapSummaryBySubgraph,
} from "@secondlayer/shared/db/queries/subgraph-gaps";
import {
	createSubgraphOperation,
	getOperationQueuePosition,
	getRecentOperationMedianDuration,
	getSubgraphOperation,
	isActiveSubgraphOperationConflict,
	listSubgraphOperations,
	requestSubgraphOperationCancel,
	requestSubgraphOperationsCancelForDelete,
	waitForSubgraphOperationsClear,
} from "@secondlayer/shared/db/queries/subgraph-operations";
import {
	encryptDatabaseUrl,
	findPublicSubgraphByName,
	getSubgraph,
	listSubgraphs,
	pgSchemaNameFor,
	updateSubgraphExpiry,
	updateSubgraphStatus,
	updateSubgraphVisibility,
} from "@secondlayer/shared/db/queries/subgraphs";
import { isPlatformMode } from "@secondlayer/shared/mode";
import {
	DeploySubgraphRequestSchema,
	type SubgraphDetail,
} from "@secondlayer/shared/schemas/subgraphs";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import { canSparseScan, sparseProbeTargets } from "@secondlayer/subgraphs";
import { Hono } from "hono";
import type { Context } from "hono";
import { sql } from "kysely";
import { getPrintSchemaBody } from "../index/print-schema.ts";
import { getAccountId, getApiKeyId } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { SubgraphRegistryCache } from "../subgraphs/cache.ts";
import { hasNonReplayableWrites } from "../subgraphs/handler-replay-safety.ts";
import { classifyOperationWeight } from "../subgraphs/operation-weight.ts";
import {
	clampDeployStartBlock,
	resolveDeployPolicy,
	resolveGenesisPolicy,
	resolvePrivateVisibilityPolicy,
	resolveSlotQuota,
} from "../subgraphs/plan-limits.ts";
import { lintPrintFields } from "../subgraphs/print-lint.ts";
import {
	SubgraphNotFoundError,
	handleRowById,
	handleTableAggregate,
	handleTableCount,
	handleTableStream,
	querySubgraph as query,
} from "../subgraphs/read-core.ts";
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
// query/SubgraphNotFoundError live in subgraphs/read-core.ts, shared with the
// open /v1/subgraphs read surface.

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

export function buildSyncInfo(
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
	integrity: "complete" | "gaps_detected" | "history_filling",
	opInfo?: {
		status: "queued" | "running";
		estimatedEvents: number | null;
		processedEvents: number | null;
		startedAt: Date | null;
		queuePosition: number | null;
		medianDurationSeconds?: number | null;
	},
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

	// Honest event-based progress/ETA when the active op carries an
	// enqueue-time estimate (sparse syncs): the block fraction is meaningless
	// when most heights are skipped. ETA needs ≥30s of rate signal.
	let queue:
		| {
				position: number | null;
				estimatedEvents: number | null;
				estimatedStartSeconds: number | null;
		  }
		| undefined;
	let estimatedEvents: number | undefined;
	let processedEvents: number | undefined;
	let etaSeconds: number | null | undefined;
	if (opInfo?.status === "queued") {
		queue = {
			position: opInfo.queuePosition ?? null,
			estimatedEvents: opInfo.estimatedEvents ?? null,
			estimatedStartSeconds:
				opInfo.queuePosition != null && opInfo.medianDurationSeconds != null
					? Math.round(opInfo.queuePosition * opInfo.medianDurationSeconds)
					: null,
		};
	} else if (opInfo?.status === "running") {
		estimatedEvents = opInfo.estimatedEvents ?? undefined;
		processedEvents = opInfo.processedEvents ?? undefined;
		const elapsedMs = opInfo.startedAt
			? Date.now() - opInfo.startedAt.getTime()
			: 0;
		if (
			estimatedEvents != null &&
			processedEvents != null &&
			processedEvents > 0 &&
			elapsedMs >= 30_000
		) {
			const rate = processedEvents / (elapsedMs / 1000);
			etaSeconds = Math.round(
				Math.max(0, estimatedEvents - processedEvents) / rate,
			);
		} else {
			etaSeconds = null;
		}
	}

	return {
		...(queue ? { queue } : {}),
		...(estimatedEvents != null ? { estimatedEvents } : {}),
		...(processedEvents != null ? { processedEvents } : {}),
		...(etaSeconds !== undefined ? { etaSeconds } : {}),
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

export async function getChainTip(): Promise<number> {
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

/** Persisted (event type, contract) probe pairs — null when not sparse-eligible. */
function parseProbeTargets(
	raw: unknown,
): { eventType: string; contractId?: string }[] | null {
	if (raw == null) return null;
	const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
	return Array.isArray(parsed) ? parsed : null;
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

// Tip-first deploys anchor live-follow + history-fill behind this margin so
// the backfill range is entirely final (its blocks are processed with the
// reorg journal off). Mirrors the streams tip reorg margin.
const TIP_FIRST_REORG_MARGIN = 2;

// Bun's import() ignores the ?query cache-buster for file: URLs (Node honors
// it), so reusing a stable per-name path re-runs the stale cached module on
// every redeploy — silently dropping schema/handler changes. Give each deploy
// a unique filename so import() always loads a genuinely new path.
export function subgraphHandlerPath(
	subgraphsDir: string,
	name: string,
	cacheBust: number = Date.now(),
): string {
	return join(subgraphsDir, `${name}.${cacheBust}.js`);
}

/** Remove prior handler files for this subgraph (legacy `${name}.js` and any
 * `${name}.<bust>.js`). Safe: the processor re-materializes from handler_code. */
export function pruneSubgraphHandlerFiles(
	subgraphsDir: string,
	name: string,
): void {
	if (!existsSync(subgraphsDir)) return;
	const legacy = `${name}.js`;
	const bustPattern = new RegExp(`^${escapeRegExp(name)}\\.\\d+\\.js$`);
	for (const file of readdirSync(subgraphsDir)) {
		if (file === legacy || bustPattern.test(file)) {
			try {
				unlinkSync(join(subgraphsDir, file));
			} catch {}
		}
	}
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

app.post("/", (c) => runSubgraphDeploy(c));

/**
 * Deploy handler, shared by the authed `/api/subgraphs` POST and the x402-paid
 * `/v1/subgraphs` POST. `identity` overrides the request-resolved account for
 * paid deploys (wallet-ghost owner) and `paidTtlMs` stamps `expires_at`.
 */
export async function runSubgraphDeploy(
	c: Context,
	identity?: { accountId: string; paidTtlMs?: number },
): Promise<Response> {
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

	// Unique filename per deploy so import() below loads fresh under Bun (which
	// ignores ?query cache-busting). Prune older files for this subgraph first.
	pruneSubgraphHandlerFiles(subgraphsDir, name);
	const handlerPath = subgraphHandlerPath(subgraphsDir, name);
	await Bun.write(handlerPath, handlerCode);

	// Import the handler to get a full SubgraphDefinition with handler functions
	let def: SubgraphDefinition;
	try {
		const mod = await import(pathToFileURL(handlerPath).href);
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

	// Best-effort print-field lint: flag `.data.<field>` reads in pinned
	// print_event handlers that were never observed on-chain for that
	// contract/topic. Advisory only — lookup failures skip the lint entirely.
	// (Runs before the dryRun returns so plans carry the warnings too; the
	// genesis clamp below only moves startBlock and can't change the lint.)
	let printFieldWarnings: string[] = [];
	try {
		printFieldWarnings = await lintPrintFields(def, (contractId) =>
			getPrintSchemaBody({ contractId }),
		);
	} catch {
		// Non-blocking by contract.
	}

	const apiKeyId = identity ? undefined : getApiKeyId(c);
	const accountId = identity?.accountId ?? getAccountId(c);

	const schemaName = pgSchemaNameFor(accountId ?? "", name);

	const { deploySchema, renderDeployPlan } = await import(
		"@secondlayer/subgraphs"
	);
	const db = getDb();

	// ── BYO data plane ──────────────────────────────────────────────────────
	// When a databaseUrl is supplied, the schema/writes/reads live in the user's
	// DB. Reject handlers whose writes can't survive at-least-once replay, verify
	// the connection, and (for --dry-run) return the DDL/grant plan without
	// touching anything.
	const byoUrl = parsed.data.databaseUrl;
	let databaseUrlEnc: Buffer | undefined;
	let byoDataDb: ReturnType<typeof getDb> | undefined;
	if (byoUrl) {
		if (hasNonReplayableWrites(handlerCode, parsed.data.sourceCode)) {
			return c.json(
				{
					error:
						"BYO subgraphs require idempotent handlers: ctx.update / ctx.patchOrInsert / " +
						"ctx.increment can double-apply on block replay (no cross-DB transaction). " +
						"Use ctx.insert or ctx.upsert with a unique key instead.",
					code: "BYO_NON_IDEMPOTENT_HANDLER",
				},
				400,
			);
		}
		try {
			await getRawClientFor(byoUrl)`SELECT 1`;
		} catch (err) {
			return c.json(
				{
					error: `Could not connect to your database: ${getErrorMessage(err)}`,
					code: "BYO_CONNECT_FAILED",
				},
				400,
			);
		}
		if (parsed.data.dryRun) {
			const plan = renderDeployPlan(def, schemaName);
			return c.json({
				dryRun: true,
				connection: "ok",
				schemaName: plan.schemaName,
				statements: plan.statements,
				grantScript: plan.grantScript,
				...(printFieldWarnings.length > 0
					? { warnings: printFieldWarnings }
					: {}),
			});
		}
		databaseUrlEnc = encryptDatabaseUrl(byoUrl);
		byoDataDb = getDb(byoUrl);
	} else if (parsed.data.dryRun) {
		const plan = renderDeployPlan(def, schemaName);
		return c.json({
			dryRun: true,
			schemaName: plan.schemaName,
			statements: plan.statements,
			...(printFieldWarnings.length > 0
				? { warnings: printFieldWarnings }
				: {}),
		});
	}

	const existing = await getSubgraph(db, name, accountId);

	// Deploying provisions a hosted tenant (index + storage + compute), so it's
	// a paid action: a free (plan 'none') account must start a 14-day trial
	// first. Gate NEW deploys only — redeploys of an already-owned subgraph are
	// grandfathered so existing free tenants don't brick. dryRun returned above,
	// so authoring/preview stays free. x402-paid deploys (identity set) already
	// paid at the rail, so they skip the gate. Shares the exempt-account
	// allowlist (seeded Explore subgraphs).
	if (!existing && !identity) {
		const deployPolicy = await resolveDeployPolicy(db, accountId ?? undefined);
		if (!deployPolicy.deployAllowed) {
			return c.json(
				{
					error:
						"Deploying a subgraph runs it on our infrastructure — start a 14-day trial (card required, cancel anytime) to deploy. Keyless reads stay free.",
					code: "PLAN_REQUIRED",
					required_plan: "launch",
					trial: true,
					upgrade_url: "https://secondlayer.tools/platform/billing",
				},
				403,
			);
		}
		const slotQuota = await resolveSlotQuota(db, accountId ?? undefined);
		if (!slotQuota.allowed) {
			return c.json(
				{
					error: `You've reached your subgraph limit (${slotQuota.current}/${slotQuota.limit}). Upgrade your plan to deploy more.`,
					code: "SUBGRAPH_SLOT_LIMIT",
					current: slotQuota.current,
					limit: slotQuota.limit,
					upgrade_url: "https://secondlayer.tools/platform/billing",
				},
				403,
			);
		}
	}

	// Visibility: explicit wins; otherwise redeploys keep what they have, new
	// managed deploys are public (shareable /v1 URL), new BYO deploys are
	// private (public reads would hit the user's own Postgres). Public names
	// are a single global namespace — claim-on-publish, first come.
	const desiredVisibility =
		parsed.data.visibility ??
		(existing ? undefined : byoUrl ? "private" : "public");
	// Private visibility is a Pro feature. Gate transitions to private only —
	// already-private subgraphs are grandfathered and unchanged redeploys pass.
	if (desiredVisibility === "private" && existing?.visibility !== "private") {
		const privacy = await resolvePrivateVisibilityPolicy(
			db,
			accountId ?? undefined,
		);
		if (!privacy.privateAllowed) {
			return c.json(
				{
					error:
						"Private subgraphs require a paid plan. Free-tier deploys are public; upgrade to make this subgraph private.",
					code: "PLAN_REQUIRED",
					required_plan: "launch",
					upgrade_url: "https://secondlayer.tools/platform/billing",
				},
				403,
			);
		}
	}
	if (desiredVisibility === "public" && existing?.visibility !== "public") {
		const claimed = await findPublicSubgraphByName(db, name);
		if (claimed && claimed.account_id !== (accountId ?? "")) {
			return c.json(
				{
					error: `Public name "${name}" is already taken. Pick another name or deploy with visibility "private".`,
					code: "PUBLIC_NAME_TAKEN",
				},
				409,
			);
		}
	}

	// Free-tier (plan 'none', incl. ghosts) indexes forward from deploy-time
	// tip only — genesis backfill is paid. The clamp rewrites the definition
	// itself: both the registered start_block and the stored definition JSON
	// come from def.startBlock (deployer regData), so this is the one spot
	// that is authoritative for every deploy surface.
	const genesisPolicy = await resolveGenesisPolicy(db, accountId ?? undefined);
	let startBlockClamped = false;
	if (!genesisPolicy.genesisAllowed) {
		const clampRes = clampDeployStartBlock({
			genesisAllowed: false,
			requested: def.startBlock,
			existingStartBlock:
				existing != null
					? (toBlockNumber(existing.start_block) ?? 0)
					: undefined,
			chainTip,
		});
		startBlockClamped = clampRes.clamped;
		def = { ...def, startBlock: clampRes.startBlock };
	}

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
	// Clamped redeploy that lands exactly on the registered start is a no-op
	// for history — suppress the explicit-startBlock force-reindex signal.
	const clampPreservedExisting =
		startBlockClamped === false &&
		!genesisPolicy.genesisAllowed &&
		existing != null &&
		def.startBlock === existingStartBlock;
	// Tip-first redeploys must refuse breaking changes BEFORE any DDL runs —
	// deploySchema applies the new schema as a side effect of detecting it.
	const tipFirst = def.backfillMode === "concurrent" && !byoUrl;
	// Tip-first history fills are backfill walks over already-live heights —
	// delta handlers would double-apply (no op-scoped cursor yet). Covers new
	// deploys, redeploys adding deltas, and blocking→concurrent flips.
	if (tipFirst && hasNonReplayableWrites(handlerCode, parsed.data.sourceCode)) {
		return c.json(
			{
				error:
					"Tip-first (backfillMode: concurrent) requires replay-safe handlers: ctx.update / ctx.patchOrInsert / ctx.increment apply deltas that double-count when the history fill revisits blocks. Deploy with the default blocking mode instead.",
				code: "TIP_FIRST_NON_REPLAYABLE_HANDLER",
			},
			422,
		);
	}
	if (tipFirst && existing) {
		const { diffSchema, hasBreakingChanges } = await import(
			"@secondlayer/subgraphs"
		);
		const existingSchema = (existing.definition as { schema?: unknown })
			?.schema;
		const verdict = hasBreakingChanges(
			diffSchema(
				(existingSchema ?? {}) as Parameters<typeof diffSchema>[0],
				def.schema as Parameters<typeof diffSchema>[1],
			),
		);
		if (verdict.breaking) {
			return c.json(
				{
					error: `Tip-first deploy refused: breaking schema change (${verdict.reasons.join("; ")}). Redeploy without --tip-first for a destructive rebuild.`,
					code: "TIP_FIRST_BREAKING_CHANGE",
				},
				422,
			);
		}
	}
	const result = await deploySchema(db, def, handlerPath, {
		apiKeyId,
		accountId,
		schemaName,
		version: parsed.data.version,
		handlerCode: parsed.data.handlerCode,
		sourceCode: parsed.data.sourceCode,
		forceReindex:
			(parsed.data.startBlock !== undefined && !clampPreservedExisting) ||
			startBlockChanged,
		dataDb: byoDataDb,
		databaseUrlEnc,
	});

	if (desiredVisibility && desiredVisibility !== existing?.visibility) {
		try {
			await updateSubgraphVisibility(
				db,
				name,
				accountId ?? "",
				desiredVisibility,
			);
		} catch (err) {
			// Race on the partial unique index: another account claimed the public
			// name between our check and this write. Deploy itself succeeded —
			// surface the conflict, leave the subgraph private.
			if (/subgraphs_public_name_uidx/.test(getErrorMessage(err))) {
				return c.json(
					{
						error: `Deployed, but public name "${name}" was just claimed by another account. The subgraph is private; rename to go public.`,
						code: "PUBLIC_NAME_TAKEN",
					},
					409,
				);
			}
			throw err;
		}
	}

	// Paid (wallet-ghost) deploys expire unless renewed or claimed.
	let expiresAt: Date | undefined;
	if (identity?.paidTtlMs) {
		expiresAt = new Date(Date.now() + identity.paidTtlMs);
		await updateSubgraphExpiry(db, name, accountId ?? "", expiresAt);
	}

	await cache.refresh();

	// Auto-trigger initial population for new deploys and breaking schema changes.
	// Managed → reindex (drops + rebuilds). BYO → backfill (forward fill, no drop):
	// reindex is blocked on BYO since dropping the user's schema from a background
	// job is destructive. A BYO backfill needs a concrete range, so it only runs
	// once there's a chain tip; otherwise forward catch-up populates as blocks land.
	let operationId: string | undefined;
	const needsPopulation =
		result.action === "created" || result.action === "reindexed";
	const startByoBackfill = byoUrl && needsPopulation && chainTip > 0;
	// Persist the sparse probe pairs so reindex/backfill routes and the
	// boot-resume sweep can classify op weight without re-importing handlers.
	const probeTargets = canSparseScan(def) ? sparseProbeTargets(def) : null;
	await db
		.updateTable("subgraphs")
		.set({ sparse_probe_targets: JSON.stringify(probeTargets) })
		.where("id", "=", result.subgraphId)
		.execute();
	// Tip-first: go live at tip NOW; history fills via a non-destructive
	// backfill op. The load-bearing write is the cursor — catch-up advances
	// from last_processed_block + 1, so without it the follower would walk
	// all of history forward and double-process against the backfill.
	let tipFirstHistory:
		| { from: number; to: number; operationId: string }
		| undefined;
	// Anchor at a FINALIZED tip: the history fill runs with journaling off
	// (backfill ranges are assumed reorg-proof), so its top must sit behind
	// the reorg margin; the live plane owns the unsafe head.
	const tipFirstAnchor = Math.max(0, chainTip - TIP_FIRST_REORG_MARGIN);
	if (
		tipFirst &&
		needsPopulation &&
		genesisPolicy.genesisAllowed &&
		tipFirstAnchor > 0 &&
		(deployStartBlock ?? 1) < tipFirstAnchor
	) {
		await updateSubgraphStatus(db, name, "active", tipFirstAnchor);
		try {
			const historyWeight = await classifyOperationWeight(
				probeTargets,
				deployStartBlock ?? 1,
				tipFirstAnchor,
			);
			const op = await createSubgraphOperation(db, {
				subgraphId: result.subgraphId,
				subgraphName: name,
				accountId,
				kind: "backfill",
				fromBlock: deployStartBlock ?? 1,
				toBlock: tipFirstAnchor,
				weight: historyWeight.weight,
				estimatedEvents: historyWeight.estimatedEvents,
			});
			operationId = op.id;
			tipFirstHistory = {
				from: deployStartBlock ?? 1,
				to: tipFirstAnchor,
				operationId: op.id,
			};
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
	} else if ((needsPopulation && !byoUrl) || startByoBackfill) {
		try {
			const populationWeight = await classifyOperationWeight(
				probeTargets,
				deployStartBlock ?? 1,
				chainTip > 0 ? chainTip : Number.MAX_SAFE_INTEGER,
			);
			const operation = await createSubgraphOperation(db, {
				subgraphId: result.subgraphId,
				subgraphName: name,
				accountId,
				kind: byoUrl ? "backfill" : "reindex",
				fromBlock: deployStartBlock,
				toBlock: chainTip > 0 ? chainTip : undefined,
				weight: populationWeight.weight,
				estimatedEvents: populationWeight.estimatedEvents,
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
			visibility: desiredVisibility ?? existing?.visibility ?? "private",
			start_block: deployStartBlock,
			...(startBlockClamped ? { start_block_clamped: true } : {}),
			...(tipFirstHistory
				? { live_from: tipFirstAnchor, history: tipFirstHistory }
				: {}),
			...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}),
			message: `Subgraph "${name}" ${result.action}`,
			...(printFieldWarnings.length > 0
				? { warnings: printFieldWarnings }
				: {}),
			...(result.diff ? { diff: result.diff } : {}),
			...(result.action === "created" || result.action === "reindexed"
				? { reindexStarted: true, operationId }
				: {}),
		},
		status,
	);
}

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

// ── Visibility (publish / unpublish) ──────────────────────────────────

// Publish = claim the name in the global public namespace + open anon reads
// on /v1/subgraphs/:name. Unpublish releases the claim; reads fall back to
// the owning account's bearer key.
app.post("/:subgraphName/publish", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);
	const db = getDb();

	if (subgraph.visibility !== "public") {
		const claimed = await findPublicSubgraphByName(db, subgraphName);
		if (claimed && claimed.account_id !== subgraph.account_id) {
			return c.json(
				{
					error: `Public name "${subgraphName}" is already taken. Rename the subgraph to publish it.`,
					code: "PUBLIC_NAME_TAKEN",
				},
				409,
			);
		}
		try {
			await updateSubgraphVisibility(
				db,
				subgraphName,
				subgraph.account_id,
				"public",
			);
		} catch (err) {
			if (/subgraphs_public_name_uidx/.test(getErrorMessage(err))) {
				return c.json(
					{
						error: `Public name "${subgraphName}" was just claimed by another account.`,
						code: "PUBLIC_NAME_TAKEN",
					},
					409,
				);
			}
			throw err;
		}
		await cache.refresh();
	}

	return c.json({
		name: subgraphName,
		visibility: "public",
		url: `/v1/subgraphs/${subgraphName}`,
	});
});

app.post("/:subgraphName/unpublish", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	if (subgraph.visibility !== "private") {
		const db = getDb();
		const privacy = await resolvePrivateVisibilityPolicy(
			db,
			subgraph.account_id,
		);
		if (!privacy.privateAllowed) {
			return c.json(
				{
					error:
						"Private subgraphs require a paid plan. Upgrade to unpublish this subgraph.",
					code: "PLAN_REQUIRED",
					required_plan: "launch",
					upgrade_url: "https://secondlayer.tools/platform/billing",
				},
				403,
			);
		}
		await updateSubgraphVisibility(
			db,
			subgraphName,
			subgraph.account_id,
			"private",
		);
		await cache.refresh();
	}

	return c.json({ name: subgraphName, visibility: "private" });
});

// ── Reindex / backfill operations ─────────────────────────────────────

app.post("/:subgraphName/reindex", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);

	const body = await c.req.json().catch(() => ({}));
	const requestedFrom =
		typeof body.fromBlock === "number" ? body.fromBlock : undefined;
	const toBlock = typeof body.toBlock === "number" ? body.toBlock : undefined;
	const db = getDb();
	const chainTip = await getChainTip();
	void chainTip;

	// Free tier may reprocess its own indexed range, never below it. The
	// fromBlock is materialized (never null) so the runtime's
	// definition.startBlock-genesis fallback can't fire for clamped accounts.
	const reindexPolicy = await resolveGenesisPolicy(db, accountId ?? undefined);
	let fromBlock = requestedFrom;
	if (!reindexPolicy.genesisAllowed) {
		const registeredStart = toBlockNumber(subgraph.start_block) ?? 0;
		fromBlock = Math.max(requestedFrom ?? registeredStart, registeredStart);
	}

	try {
		const reindexWeight = await classifyOperationWeight(
			parseProbeTargets(subgraph.sparse_probe_targets),
			fromBlock ?? 1,
			toBlock ?? (await getChainTip()),
		);
		const operation = await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName,
			accountId,
			kind: "reindex",
			fromBlock,
			toBlock,
			weight: reindexWeight.weight,
			estimatedEvents: reindexWeight.estimatedEvents,
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

	// Backfill re-runs blocks the live walk already processed; delta handlers
	// (ctx.increment / patchOrInsert / update) double-apply on those heights.
	if (hasNonReplayableWrites(subgraph.handler_code)) {
		return c.json(
			{
				error:
					"This subgraph's handlers apply deltas (ctx.increment / ctx.patchOrInsert / ctx.update); a backfill would re-run processed blocks and double-count. Use reindex for a clean rebuild instead.",
				code: "BACKFILL_NON_REPLAYABLE_HANDLER",
			},
			422,
		);
	}

	// Backfill is inherently historical — free tier indexes forward only.
	const backfillPolicy = await resolveGenesisPolicy(db, accountId ?? undefined);
	if (!backfillPolicy.genesisAllowed) {
		return c.json(
			{
				error:
					"Historical backfill requires a paid plan — free-tier subgraphs index forward from deploy. Upgrade to backfill history.",
				code: "GENESIS_BACKFILL_REQUIRES_PLAN",
			},
			403,
		);
	}

	try {
		const backfillWeight = await classifyOperationWeight(
			parseProbeTargets(subgraph.sparse_probe_targets),
			fromBlock ?? 1,
			toBlock ?? (await getChainTip()),
		);
		const operation = await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName,
			accountId,
			kind: "backfill",
			fromBlock,
			toBlock,
			weight: backfillWeight.weight,
			estimatedEvents: backfillWeight.estimatedEvents,
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
		// Wait for the processor to observe `cancel_requested` and release its
		// row + advisory locks. Without this, `DROP SCHEMA ... CASCADE` blocks
		// behind the live reindex transaction and the API socket-times-out
		// into a 500 — the bug surfaced by `sl subgraphs delete <name>` while
		// a reindex was running.
		const cleared = await waitForSubgraphOperationsClear(db, subgraph.id, {
			timeoutMs: 30_000,
			pollMs: 500,
		});
		if (!cleared) {
			logger.warn(
				"Active operations did not clear within timeout; proceeding with DROP SCHEMA may block",
				{
					subgraph: subgraphName,
					force,
				},
			);
		}
	}

	// deleteSubgraph drops the PG schema + removes the registry row atomically
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
	const [liveResult, chainTip, gapSummaries, subCounts] = await Promise.all([
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
				"last_error",
				"last_error_at",
				"updated_at",
			])
			.execute()
			// biome-ignore lint/suspicious/noExplicitAny: fallback empty array
			.catch(() => [] as any[]),
		getChainTip(),
		getGapSummaryBySubgraph(db).catch(() => []),
		db
			.selectFrom("subscriptions")
			.select("subgraph_name")
			.select((eb) => eb.fn.count<number>("id").as("count"))
			.where("account_id", "=", accountId ?? "")
			.where("subgraph_name", "is not", null)
			.groupBy("subgraph_name")
			.execute()
			.catch(() => [] as { subgraph_name: string | null; count: number }[]),
	]);

	const liveStats = new Map<string, (typeof liveResult)[0]>();
	for (const r of liveResult) liveStats.set(r.id, r);

	const subCountMap = new Map<string, number>();
	for (const r of subCounts) {
		if (r.subgraph_name) subCountMap.set(r.subgraph_name, Number(r.count));
	}

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
				visibility: v.visibility as "public" | "private",
				lastError: live?.last_error ?? null,
				lastErrorAt: live?.last_error_at?.toISOString() ?? null,
				updatedAt: (live?.updated_at ?? v.updated_at)?.toISOString() ?? null,
				subscriptionCount: subCountMap.get(v.name) ?? 0,
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
	return buildSubgraphDetailFromRow(getOwnedSubgraph(subgraphName, accountId));
}

// Shared with /v1/subgraphs doc routes, which resolve by visibility instead
// of ownership.
export async function buildSubgraphDetailFromRow(
	subgraph: Subgraph,
): Promise<SubgraphDetail> {
	const subgraphName = subgraph.name;
	const subgraphSchema = getSubgraphSchema(subgraph);
	const tables: SubgraphDetail["tables"] = {};
	const sn = subgraphSchemaName(subgraph);

	const schemaEntries = Object.entries(subgraphSchema);
	const db = getDb();
	const [countResults, liveRow, chainTip, gapResult] = await Promise.all([
		Promise.allSettled(
			schemaEntries.map(([tableName]) =>
				query(
					subgraph,
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
	const recentOps = await listSubgraphOperations(db, subgraph.id);
	const activeOp = recentOps.find(
		(o) => o.status === "queued" || o.status === "running",
	);
	const opInfo = activeOp
		? {
				status: activeOp.status as "queued" | "running",
				estimatedEvents:
					activeOp.estimated_events == null
						? null
						: Number(activeOp.estimated_events),
				processedEvents:
					activeOp.processed_events == null
						? null
						: Number(activeOp.processed_events),
				startedAt: activeOp.started_at,
				queuePosition:
					activeOp.status === "queued"
						? await getOperationQueuePosition(db, activeOp.id)
						: null,
				medianDurationSeconds:
					activeOp.status === "queued"
						? await getRecentOperationMedianDuration(
								db,
								(activeOp.weight as "light" | "heavy") ?? "heavy",
							)
						: null,
			}
		: undefined;
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
		// An active history fill ALWAYS reads as history_filling — a clean
		// tip-first fill records no gap rows, but the history is still absent.
		activeOp?.kind === "backfill"
			? "history_filling"
			: hasGaps
				? "gaps_detected"
				: "complete",
		opInfo,
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
		visibility: subgraph.visibility as "public" | "private",
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

export function readSpecOptions(c: {
	req: {
		url: string;
		query(name: string): string | undefined;
		header(name: string): string | undefined;
	};
}): SubgraphSpecOptions {
	const server = c.req.query("server");
	if (server) return { serverUrl: server };
	const url = new URL(c.req.url);
	const proto =
		c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
	return { serverUrl: `${proto}://${url.host}` };
}

// Friendly redirect: /:subgraphName/openapi → /openapi.json (Scalar/Swagger
// users often type the bare name; without this it falls through to the
// table handler and 404s as TABLE_NOT_FOUND.
app.get("/:subgraphName/openapi", (c) => {
	const { subgraphName } = c.req.param();
	return c.redirect(`/api/subgraphs/${subgraphName}/openapi.json`, 308);
});

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
					subgraph,
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
		// Without this the detail page falls back to "private" while the list
		// (which does return visibility) shows the real value — a mismatch.
		visibility: subgraph.visibility as "public" | "private",
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

// ── Operation status (poll reindex/backfill/stop progress) ───────────────

/** Map a tracked operation to the public status shape (+ derived progress). */
function toOperationResponse(
	op: SubgraphOperation,
	chainTip: number,
	queuePosition?: number | null,
) {
	const from = op.from_block ?? 1;
	const to = op.to_block ?? chainTip;
	const total = to - from + 1;
	const estimated =
		op.estimated_events == null ? null : Number(op.estimated_events);
	const processedEvents =
		op.processed_events == null ? null : Number(op.processed_events);
	// Event-based progress when the enqueue-time estimate exists (sparse ops) —
	// the block fraction is meaningless when most blocks are skipped.
	const progress =
		op.status === "completed"
			? 1
			: estimated != null && estimated > 0 && processedEvents != null
				? Math.min(1, processedEvents / estimated)
				: op.processed_blocks != null && total > 0
					? Math.min(1, Math.max(0, op.processed_blocks / total))
					: null;
	return {
		id: op.id,
		subgraphName: op.subgraph_name,
		kind: op.kind,
		status: op.status,
		weight: op.weight,
		fromBlock: op.from_block,
		toBlock: op.to_block,
		processedBlocks: op.processed_blocks,
		cursorBlock: op.cursor_block == null ? null : Number(op.cursor_block),
		estimatedEvents: estimated,
		processedEvents,
		progress,
		...(queuePosition != null ? { queuePosition } : {}),
		error: op.error,
		startedAt: op.started_at?.toISOString() ?? null,
		finishedAt: op.finished_at?.toISOString() ?? null,
		createdAt: op.created_at.toISOString(),
		updatedAt: op.updated_at.toISOString(),
	};
}

app.get("/:subgraphName/operations", async (c) => {
	const { subgraphName } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);
	const db = getDb();
	const [ops, chainTip] = await Promise.all([
		listSubgraphOperations(db, subgraph.id),
		getChainTip(),
	]);
	const positions = new Map<string, number | null>();
	for (const op of ops) {
		if (op.status === "queued") {
			positions.set(op.id, await getOperationQueuePosition(db, op.id));
		}
	}
	return c.json({
		operations: ops.map((op) =>
			toOperationResponse(op, chainTip, positions.get(op.id)),
		),
	});
});

app.get("/:subgraphName/operations/:operationId", async (c) => {
	const { subgraphName, operationId } = c.req.param();
	const accountId = getAccountId(c);
	const subgraph = getOwnedSubgraph(subgraphName, accountId);
	const db = getDb();
	const op = await getSubgraphOperation(db, operationId);
	// Scope to the named subgraph so one account can't read another's op by id.
	if (!op || op.subgraph_id !== subgraph.id) {
		return c.json(
			{
				error: `Operation "${operationId}" not found for "${subgraphName}"`,
				code: "OPERATION_NOT_FOUND",
			},
			404,
		);
	}
	const chainTip = await getChainTip();
	const position =
		op.status === "queued" ? await getOperationQueuePosition(db, op.id) : null;
	return c.json(toOperationResponse(op, chainTip, position));
});

// ── Count rows ──────────────────────────────────────────────────────────

app.get("/:subgraphName/:tableName/count", async (c) => {
	const { subgraphName, tableName } = c.req.param();
	const subgraph = getOwnedSubgraph(subgraphName, getAccountId(c));
	return handleTableCount(c, subgraph, tableName);
});

// ── Aggregate over rows ─────────────────────────────────────────────────

// Scalar aggregates (_count/_countDistinct/_sum/_min/_max) over the same
// filtered set as the list/count endpoints. SUM/MIN/MAX return lossless strings
// (NUMERIC ::text); count/countDistinct return JSON numbers. Registered before
// `/:id` so the static `aggregate` segment wins over the row-id param.
app.get("/:subgraphName/:tableName/aggregate", async (c) => {
	const { subgraphName, tableName } = c.req.param();
	const subgraph = getOwnedSubgraph(subgraphName, getAccountId(c));
	return handleTableAggregate(c, subgraph, tableName);
});

// ── Get row by ID ───────────────────────────────────────────────────────

// SSE: stream rows as they're indexed. Poll-based v1 — tails the table by a
// monotonic `_id` cursor every ~1.5s and pushes each new row as an SSE message;
// reuses the same filter query params as the REST list endpoint. Go-forward by
// default; `?since=<block>` replays from a block then tails. Open auth (matches
// the read endpoints). No subscription record is created — this is ephemeral.
// Registered before the `/:id` route so a static `stream` segment wins over the
// row-id param (`return;` does not fall through in Hono).
app.get("/:subgraphName/:tableName/stream", (c) => {
	const { subgraphName, tableName } = c.req.param();
	const subgraph = getOwnedSubgraph(subgraphName, getAccountId(c));
	return handleTableStream(c, subgraph, tableName);
});

app.get("/:subgraphName/:tableName/:id", async (c) => {
	const { subgraphName, tableName, id } = c.req.param();
	if (id === "count" || id === "stream" || id === "aggregate") return;
	const subgraph = getOwnedSubgraph(subgraphName, getAccountId(c));
	return handleRowById(c, subgraph, tableName, id);
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

		const orderBy =
			parsed.sorts.length > 0
				? parsed.sorts.map((s) => `${ident(s.column)} ${s.order}`).join(", ")
				: '"_id" ASC';
		text += ` ORDER BY ${orderBy}`;
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
				query(subgraph, text, params),
				query(subgraph, countText, countParams),
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
			query(subgraph, text, params),
			query(subgraph, countText),
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
