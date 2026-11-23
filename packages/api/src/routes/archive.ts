/**
 * Pricing lives here ONLY (never echoed back to or trusted from the CLI):
 * the request carries R2 object keys, and the dataset — the only thing that
 * determines price — is derived from the key itself via
 * `ARCHIVE_PARTITION_KEY_RE`, never from a client-sent field. A client that
 * could name its own dataset could always claim "blocks" and pay a third of
 * the events price.
 */

import { meter } from "@secondlayer/platform/billing/meter";
import {
	PRICES,
	nextMonthResetLabel,
} from "@secondlayer/platform/billing/prices";
import { getCredits } from "@secondlayer/platform/db/queries/account-credits";
import {
	allowancePartitionsUsedThisMonth,
	recentChargedPaths,
	recordFetch,
} from "@secondlayer/platform/db/queries/archive-fetches";
import {
	ARCHIVE_DATASETS,
	type ArchiveDataset,
	assertNeverDataset,
} from "@secondlayer/shared/archive/datasets";
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

/**
 * Price per partition, in USD-micros (1 USD = 1_000_000 micros — matches
 * `usdToMicros`). Founder-approved 2026-08-16:
 * $0.05 for blocks/transactions, $0.15 for events (~7x the rows).
 * `state_writes` (founder 2026-10-19) prices and meters as events: a
 * similar row weight, so no new unit. Lives in
 * `@secondlayer/platform/billing/prices` now — the one price table —
 * read here, never hardcoded twice. Server-only by design:
 * changing a price is an API deploy, never a CLI release.
 */
const PRICE_MICROS: Record<ArchiveDataset, bigint> = {
	blocks: PRICES["archive.partition"],
	transactions: PRICES["archive.partition"],
	events: PRICES["archive.partition.events"],
	state_writes: PRICES["archive.partition.events"],
};

function meterUnitForDataset(
	dataset: ArchiveDataset,
): "archive.partition" | "archive.partition.events" {
	switch (dataset) {
		case "blocks":
		case "transactions":
			return "archive.partition";
		case "events":
		case "state_writes":
			return "archive.partition.events";
		default:
			return assertNeverDataset(dataset);
	}
}

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
export const ARCHIVE_PARTITION_KEY_RE = new RegExp(
	`^(${ARCHIVE_DATASETS.join("|")})/\\d+-\\d+-[0-9a-f]{16}\\.parquet$`,
);

function stripArchivePrefix(path: string): string {
	const prefix = archiveKeyPrefix();
	return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
}

export function resolveObjectKey(path: string): string {
	const prefix = archiveKeyPrefix();
	return path.startsWith(`${prefix}/`) ? path : `${prefix}/${path}`;
}

const MAX_FETCH_BATCH = 64;

/** Monthly free-repair allowance, in partitions (6 bundle-equivalents × 4
 *  datasets per bundle). `flow: "repair"` only. */
const ALLOWANCE_MONTHLY_PARTITIONS = 24;

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
	//
	// Deduped on the manifest-relative form: the full key and the relative
	// path name the same partition, so both spellings must collapse to one
	// charge and one 24h re-issue window.
	return { paths: [...new Set(paths.map(stripArchivePrefix))], flow };
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

class ArchiveSpendCapError extends Error {
	constructor() {
		super("spend cap reached for archive fetch batch");
	}
}

type PricedPath = {
	path: string;
	dataset: ArchiveDataset;
	usdMicros: bigint;
	viaAllowance: boolean;
};

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
	getConfig?: () => ArchiveR2Config | null;
	presign?: (params: { bucket: string; key: string }) => Promise<string>;
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
				throw new Error("archive R2 not configured");
			}
			const client = createArchiveS3Client(config);
			return presignArchiveObject({
				client,
				bucket: params.bucket,
				key: params.key,
			});
		});

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
			bundles: paths.length / ARCHIVE_DATASETS.length,
			usd_micros: Number(usdMicros),
			usd: (Number(usdMicros) / 1_000_000).toFixed(2),
			free_allowance_applied_micros: Number(freeAllowanceMicros),
			allowance_remaining_bundles: Math.floor(
				allowanceRemainingAfter / ARCHIVE_DATASETS.length,
			),
			balance_usd_micros: Number(balance),
			sufficient: balance >= usdMicros,
		});
	});

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
					const startingBalance = await getCredits(trx, accountId);
					for (const p of priced) {
						if (p.usdMicros === 0n) continue;
						const result = await meter(trx, {
							accountId,
							unit: meterUnitForDataset(p.dataset),
							quantity: 1,
							source: "archive",
							idempotencyKey: `archive:${accountId}:${p.path}:${nowTs.toISOString().slice(0, 10)}`,
							occurredAt: nowTs,
						});
						if (!result.debited) {
							// A balance that covers the batch means the spend cap refused it.
							throw total > startingBalance
								? new InsufficientArchiveCreditsError(total - startingBalance)
								: new ArchiveSpendCapError();
						}
					}
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
			if (err instanceof ArchiveSpendCapError) {
				return c.json(
					{
						error: "spend_cap_reached",
						message: `You reached your monthly spend cap. Archive fetches are paused until ${nextMonthResetLabel(nowTs)} or until you raise the cap at https://secondlayer.tools/account/credits#cap.`,
					},
					402,
				);
			}
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
