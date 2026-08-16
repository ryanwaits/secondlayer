/**
 * The archive fetch gate (design-f089) — quote, charge, presign.
 *
 *   POST /api/archive/quote   authed, free, idempotent — prices a batch of
 *                             R2 partition keys without charging anything.
 *   POST /api/archive/fetch   authed, charges, returns presigned GET URLs —
 *                             the only route that debits credits or reads
 *                             gated bytes.
 *
 * Session-authed upstream via the `PLATFORM_PATHS` block in `create-app.ts`
 * (same pattern as `routes/billing.ts`), platform mode only — self-host
 * instances don't host the archive, so they never mount this router.
 *
 * Pricing lives here ONLY (never echoed back to or trusted from the CLI):
 * the request carries R2 object keys, and the dataset — the only thing that
 * determines price — is derived from the key itself via
 * `ARCHIVE_PARTITION_KEY_RE`, never from a client-sent field. A client that
 * could name its own dataset could always claim "blocks" and pay a third of
 * the events price.
 */

import {
	debitCredits,
	getCredits,
	recordCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import {
	allowancePartitionsUsedThisMonth,
	recentChargedPaths,
	recordFetch,
} from "@secondlayer/platform/db/queries/archive-fetches";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import {
	ARCHIVE_PRESIGN_TTL_SECONDS,
	type ArchiveR2Config,
	createArchiveS3Client,
	getArchiveR2ConfigFromEnv,
	presignArchiveObject,
} from "../lib/archive-r2.ts";
import { getAccountId } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";

/** The three canonical archive datasets (`export-snapshot.ts`'s `CanonicalDataset`,
 *  duplicated as a literal union here rather than imported — this route must
 *  not depend on `@secondlayer/indexer` for its pricing surface). */
type ArchiveDataset = "blocks" | "transactions" | "events";

/**
 * Price per partition, in USD-micros (1 USD = 1_000_000 micros — matches
 * `usdToMicros`). Founder-approved 2026-08-16 (`design-f089-archive-fetch-gate.md`):
 * $0.05 for blocks/transactions, $0.15 for events (~7x the rows). Server-only
 * by design — changing a price is an API deploy, never a CLI release.
 */
const PRICE_MICROS: Record<ArchiveDataset, bigint> = {
	blocks: 50_000n,
	transactions: 50_000n,
	events: 150_000n,
};

/** Object key prefix the archive publisher writes under
 *  (`CANONICAL_ARCHIVE_PREFIX` in `packages/indexer/src/archive/upload-snapshot.ts`).
 *  Overridable so a bucket layout change is a config edit, not a deploy. */
function archiveKeyPrefix(): string {
	return process.env.ARCHIVE_R2_PREFIX ?? "secondlayer/mainnet/canonical/v1";
}

/**
 * Matches a canonical partition object's key relative to the archive prefix:
 * `<dataset>/<fromBlock>-<toBlock>-<sha256-prefix16>.parquet` — the exact
 * shape `uploadCanonicalSnapshot` writes (`export-snapshot.ts`'s
 * `objectName = "${fromBlock}-${toBlock}-${sha256.slice(0, 16)}.parquet"`).
 * Exported for tests; this is the ONLY thing standing between a client and
 * naming its own (cheaper) dataset.
 */
export const ARCHIVE_PARTITION_KEY_RE =
	/^(blocks|transactions|events)\/\d+-\d+-[0-9a-f]{16}\.parquet$/;

/**
 * The signed manifest's `partition.path` is relative
 * (`<dataset>/<from>-<to>-<hash16>.parquet` — `export-snapshot.ts:555`); the
 * CLI never learns the R2 prefix, so it sends that relative form as-is. A
 * full R2 key (already carrying the prefix) is accepted unchanged too, so
 * older callers and direct-key tests still work. Strips the prefix when
 * present, then matches the bare partition shape either way.
 */
function stripArchivePrefix(path: string): string {
	const prefix = archiveKeyPrefix();
	return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
}

/**
 * Resolve a path (relative or already-prefixed) to the full R2 object key
 * used at presign time. Already-prefixed paths pass through unchanged;
 * relative paths get the archive prefix prepended.
 */
export function resolveObjectKey(path: string): string {
	const prefix = archiveKeyPrefix();
	return path.startsWith(`${prefix}/`) ? path : `${prefix}/${path}`;
}

/** Batch cap for `/fetch` — the CLI pages larger restores across calls. */
const MAX_FETCH_BATCH = 64;

/** Monthly free-repair allowance, in partitions (6 bundle-equivalents × 3
 *  datasets per bundle). `flow: "repair"` only. */
const ALLOWANCE_MONTHLY_PARTITIONS = 18;

/** Derive the dataset a full R2 object key belongs to, or `null` if the key
 *  doesn't match the archive prefix + partition shape. Never trust a
 *  client-sent dataset field — this is the sole authority. */
export function deriveDatasetFromPath(path: string): ArchiveDataset | null {
	const rest = stripArchivePrefix(path);
	const match = ARCHIVE_PARTITION_KEY_RE.exec(rest);
	return match ? (match[1] as ArchiveDataset) : null;
}

type ArchiveFlow = "bootstrap" | "repair";

type ParsedArchiveRequest = { paths: string[]; flow: ArchiveFlow };

function parseArchiveRequestBody(
	body: unknown,
): ParsedArchiveRequest | { error: string } {
	if (typeof body !== "object" || body === null) {
		return { error: "request body must be a JSON object" };
	}
	const { paths, flow } = body as { paths?: unknown; flow?: unknown };
	if (
		!Array.isArray(paths) ||
		paths.length === 0 ||
		!paths.every((p) => typeof p === "string")
	) {
		return { error: "paths must be a non-empty array of strings" };
	}
	if (flow !== "bootstrap" && flow !== "repair") {
		return { error: 'flow must be "bootstrap" or "repair"' };
	}
	// Dedupe: a repeated path would otherwise be priced twice in a quote
	// (overstating the charge) and, on `/fetch`, insert two `archive_fetches`
	// rows with the identical `(account_id, path, charged_at)` tuple —
	// tripping the migration's UNIQUE constraint and 500ing a paid route on a
	// malformed-but-plausible input. A batch that dedupes to fewer paths is
	// still a valid (non-empty, checked above) batch.
	return { paths: [...new Set(paths)], flow };
}

/** Thrown inside the charge transaction when the aggregate debit for a
 *  batch fails; caught by the route to answer 402 with the shortfall. The
 *  throw unwinds the whole transaction, so no `archive_fetches` row and no
 *  balance change survives — the all-or-nothing guarantee the batch charge
 *  requires. */
class InsufficientArchiveCreditsError extends Error {
	shortfallUsdMicros: bigint;
	constructor(shortfallUsdMicros: bigint) {
		super("insufficient credits for archive fetch batch");
		this.shortfallUsdMicros = shortfallUsdMicros;
	}
}

type PricedPath = {
	path: string;
	dataset: ArchiveDataset;
	usdMicros: bigint;
	viaAllowance: boolean;
};

/** Price every path in the batch, applying the 24h re-issue window and (for
 *  `repair` flow) the monthly allowance, in path order. Pure pricing logic —
 *  no writes — shared by `/quote` (preview) and `/fetch` (charged inside a
 *  transaction on the same connection). */
async function priceBatch(params: {
	db: Parameters<typeof recentChargedPaths>[0];
	accountId: string;
	paths: string[];
	flow: ArchiveFlow;
	now: Date;
}): Promise<{ priced: PricedPath[]; allowanceRemainingAfter: number }> {
	const { db, accountId, paths, flow, now } = params;
	const alreadyCharged = await recentChargedPaths(db, accountId, paths, now);
	const usedThisMonth =
		flow === "repair"
			? await allowancePartitionsUsedThisMonth(db, accountId, now)
			: 0;
	let remaining = Math.max(0, ALLOWANCE_MONTHLY_PARTITIONS - usedThisMonth);

	const priced: PricedPath[] = [];
	for (const path of paths) {
		// Validated by the caller before priceBatch runs.
		const dataset = deriveDatasetFromPath(path) as ArchiveDataset;
		if (alreadyCharged.has(path)) {
			priced.push({ path, dataset, usdMicros: 0n, viaAllowance: false });
			continue;
		}
		if (flow === "repair" && remaining > 0) {
			remaining--;
			priced.push({ path, dataset, usdMicros: 0n, viaAllowance: true });
			continue;
		}
		priced.push({
			path,
			dataset,
			usdMicros: PRICE_MICROS[dataset],
			viaAllowance: false,
		});
	}
	return { priced, allowanceRemainingAfter: remaining };
}

export type ArchiveRouterOptions = {
	/** Injectable so tests never touch R2. Defaults to reading the real
	 *  `STREAMS_BULK_R2_*` env and returning `null` when unset. */
	getConfig?: () => ArchiveR2Config | null;
	/** Injectable presigner. Defaults to a real R2 `GetObjectCommand` presign
	 *  built from `getConfig()`'s credentials. */
	presign?: (params: { bucket: string; key: string }) => Promise<string>;
	/** Injectable clock for the 24h re-issue window and allowance month. */
	now?: () => Date;
};

export function createArchiveRouter(options: ArchiveRouterOptions = {}): Hono {
	const app = new Hono();
	const getConfig = options.getConfig ?? getArchiveR2ConfigFromEnv;
	const now = options.now ?? (() => new Date());
	const presign =
		options.presign ??
		(async (params: { bucket: string; key: string }) => {
			const config = getConfig();
			if (!config) {
				// Guarded by the route's own 503 check before presign is ever
				// called — this is a defensive backstop, not a reachable path.
				throw new Error("archive R2 not configured");
			}
			const client = createArchiveS3Client(config);
			return presignArchiveObject({
				client,
				bucket: params.bucket,
				key: params.key,
			});
		});

	/**
	 * POST /api/archive/quote   body: { paths: string[], flow: "bootstrap" | "repair" }
	 *
	 * Free, idempotent price preview. Never debits, never writes. Reflects
	 * the 24h re-issue window and (for `repair`) the monthly allowance, so
	 * the number the operator confirms is the number `/fetch` will charge.
	 */
	app.post("/quote", async (c) => {
		if (!getConfig()) {
			return c.json({ error: "archive_gate_not_configured" }, 503);
		}
		const accountId = getAccountId(c);
		if (!accountId) return c.json({ error: "Unauthorized" }, 401);

		const body = await c.req.json().catch(() => {
			throw new InvalidJSONError();
		});
		const parsed = parseArchiveRequestBody(body);
		if ("error" in parsed) return c.json({ error: parsed.error }, 400);
		const { paths, flow } = parsed;

		const invalid = paths.filter((p) => deriveDatasetFromPath(p) === null);
		if (invalid.length > 0) {
			return c.json(
				{
					error: `malformed archive path(s): ${invalid.slice(0, 5).join(", ")}`,
				},
				400,
			);
		}

		const db = getDb();
		const nowTs = now();
		const { priced, allowanceRemainingAfter } = await priceBatch({
			db,
			accountId,
			paths,
			flow,
			now: nowTs,
		});

		const usdMicros = priced.reduce(
			(sum, p) => sum + (p.viaAllowance ? 0n : p.usdMicros),
			0n,
		);
		const freeAllowanceMicros = priced.reduce(
			(sum, p) => sum + (p.viaAllowance ? PRICE_MICROS[p.dataset] : 0n),
			0n,
		);
		const balance = await getCredits(db, accountId);

		return c.json({
			partitions: paths.length,
			bundles: paths.length / 3,
			usd_micros: Number(usdMicros),
			usd: (Number(usdMicros) / 1_000_000).toFixed(2),
			free_allowance_applied_micros: Number(freeAllowanceMicros),
			allowance_remaining_bundles: Math.floor(allowanceRemainingAfter / 3),
			balance_usd_micros: Number(balance),
			sufficient: balance >= usdMicros,
		});
	});

	/**
	 * POST /api/archive/fetch   body: { paths: string[], flow: "bootstrap" | "repair" }
	 *
	 * Charges (re-deriving price server-side — never trusts a client-echoed
	 * quote) and returns presigned GET URLs. One DB transaction per batch:
	 * an aggregate debit for the batch total, so a partial restore never
	 * half-charges — either the whole batch's price is affordable and every
	 * path is charged + logged, or nothing is.
	 */
	app.post("/fetch", async (c) => {
		const config = getConfig();
		if (!config) {
			return c.json({ error: "archive_gate_not_configured" }, 503);
		}
		const accountId = getAccountId(c);
		if (!accountId) return c.json({ error: "Unauthorized" }, 401);

		const body = await c.req.json().catch(() => {
			throw new InvalidJSONError();
		});
		const parsed = parseArchiveRequestBody(body);
		if ("error" in parsed) return c.json({ error: parsed.error }, 400);
		const { paths, flow } = parsed;

		if (paths.length > MAX_FETCH_BATCH) {
			return c.json(
				{
					error: `batch of ${paths.length} exceeds max ${MAX_FETCH_BATCH} paths per call`,
				},
				413,
			);
		}

		const invalid = paths.filter((p) => deriveDatasetFromPath(p) === null);
		if (invalid.length > 0) {
			return c.json(
				{
					error: `malformed archive path(s): ${invalid.slice(0, 5).join(", ")}`,
				},
				400,
			);
		}

		const db = getDb();
		const nowTs = now();

		let priced: PricedPath[];
		try {
			priced = await db.transaction().execute(async (trx) => {
				const { priced } = await priceBatch({
					db: trx,
					accountId,
					paths,
					flow,
					now: nowTs,
				});

				const total = priced.reduce((sum, p) => sum + p.usdMicros, 0n);
				if (total > 0n) {
					const debit = await debitCredits(trx, accountId, total);
					if (!debit.ok) {
						const balance = await getCredits(trx, accountId);
						throw new InsufficientArchiveCreditsError(total - balance);
					}
					await recordCreditsSpend(trx, accountId, total, nowTs);
				}
				// Charge-log rows store the path AS SENT (relative or full-key) —
				// not the resolved object key — so the 24h re-issue window
				// (`recentChargedPaths`) matches whatever form the CLI re-sends on
				// retry/resume, without needing to normalize both sides.
				for (const p of priced) {
					await recordFetch(
						trx,
						{
							accountId,
							path: p.path,
							dataset: p.dataset,
							usdMicros: p.usdMicros,
							viaAllowance: p.viaAllowance,
						},
						nowTs,
					);
				}
				return priced;
			});
		} catch (err) {
			if (err instanceof InsufficientArchiveCreditsError) {
				return c.json(
					{
						error: "insufficient_credits",
						shortfall_usd_micros: Number(err.shortfallUsdMicros),
					},
					402,
				);
			}
			throw err;
		}

		const expiresAt = new Date(
			nowTs.getTime() + ARCHIVE_PRESIGN_TTL_SECONDS * 1000,
		).toISOString();
		const urls = await Promise.all(
			priced.map(async (p) => ({
				path: p.path,
				url: await presign({
					bucket: config.bucket,
					key: resolveObjectKey(p.path),
				}),
				expires_at: expiresAt,
				charged_usd_micros: Number(p.usdMicros),
			})),
		);

		const chargedTotal = priced.reduce((sum, p) => sum + p.usdMicros, 0n);
		const balanceAfter = await getCredits(db, accountId);

		return c.json({
			urls,
			charged_total_usd_micros: Number(chargedTotal),
			balance_after_usd_micros: Number(balanceAfter),
		});
	});

	return app;
}

export default createArchiveRouter();
