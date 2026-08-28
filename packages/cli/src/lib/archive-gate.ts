import { CliHttpError, httpArchiveOps } from "./http.ts";

/**
 * The archive fetch gate — CLI-side quote/fetch client (design-f089).
 *
 * Gates ONLY the official hosted archive. Anyone pointing `--against` at a
 * mirror, a teammate's box, or a local directory pays nothing and talks to
 * no Secondlayer server — that is self-hosting working as designed, not a
 * billing leak. Pricing, allowance arithmetic, and presigning are
 * server-owned (`packages/api/src/routes/archive.ts`); this module renders
 * what the server returns and never computes a price itself.
 */

/**
 * The official hosted archive's host. Exported so the predicate is testable
 * against a real string and so the constant has exactly one definition.
 */
export const OFFICIAL_ARCHIVE_HOST = "archive.secondlayer.tools";

/**
 * True only when `reference` is a remote manifest served from the official
 * archive host. Everything else — mirrors, localhost, local file paths — is
 * free and must never reach this module's HTTP seam.
 */
export function isOfficialArchive(reference: {
	isRemote: boolean;
	origin: string;
}): boolean {
	if (!reference.isRemote) return false;
	try {
		return new URL(reference.origin).hostname === OFFICIAL_ARCHIVE_HOST;
	} catch {
		return false;
	}
}

export type ArchiveFlow = "bootstrap" | "repair";

export type ArchiveQuote = {
	partitions: number;
	bundles: number;
	usdMicros: number;
	usd: string;
	freeAllowanceAppliedMicros: number;
	allowanceRemainingBundles: number;
	balanceUsdMicros: number;
	sufficient: boolean;
};

export type QuoteResult =
	| { ok: true; quote: ArchiveQuote }
	| { ok: false; kind: "not_configured" }
	| { ok: false; kind: "not_authed"; message: string }
	| { ok: false; kind: "error"; message: string };

type QuoteResponseBody = {
	partitions: number;
	bundles: number;
	usd_micros: number;
	usd: string;
	free_allowance_applied_micros: number;
	allowance_remaining_bundles: number;
	balance_usd_micros: number;
	sufficient: boolean;
};

type FetchResponseBody = {
	urls: Array<{
		path: string;
		url: string;
		expires_at: string;
		charged_usd_micros: number;
	}>;
	charged_total_usd_micros: number;
	balance_after_usd_micros: number;
};

/** Injectable HTTP seam, same shape as `httpArchiveOps` — real by default,
 *  stubbed in tests so the gate client is exercised with no network and no
 *  session. */
export type ArchiveGateDeps = {
	httpArchiveOps: typeof httpArchiveOps;
};

const defaultDeps: ArchiveGateDeps = { httpArchiveOps };

function quoteFromBody(body: QuoteResponseBody): ArchiveQuote {
	return {
		partitions: body.partitions,
		bundles: body.bundles,
		usdMicros: body.usd_micros,
		usd: body.usd,
		freeAllowanceAppliedMicros: body.free_allowance_applied_micros,
		allowanceRemainingBundles: body.allowance_remaining_bundles,
		balanceUsdMicros: body.balance_usd_micros,
		sufficient: body.sufficient,
	};
}

/**
 * Price a batch of manifest partition paths, free and idempotent — no
 * charge, no writes. Maps 503 (gate unconfigured) and 401 (not logged in)
 * into typed results rather than throwing, so command handlers can print a
 * clean message instead of an uncaught-exception stack.
 */
export async function quoteArchiveFetch(
	paths: string[],
	flow: ArchiveFlow,
	deps: ArchiveGateDeps = defaultDeps,
): Promise<QuoteResult> {
	try {
		const body = await deps.httpArchiveOps<QuoteResponseBody>(
			"/api/archive/quote",
			{ method: "POST", body: { paths, flow } },
		);
		return { ok: true, quote: quoteFromBody(body) };
	} catch (err) {
		if (err instanceof CliHttpError) {
			if (err.status === 503) return { ok: false, kind: "not_configured" };
			if (err.status === 401) {
				return { ok: false, kind: "not_authed", message: err.message };
			}
			return { ok: false, kind: "error", message: err.message };
		}
		throw err;
	}
}

/** The literal command printed alongside every insufficient-balance
 *  message — never upsell prose, just the fix. */
const BUY_CREDITS_COMMAND = "secondlayer credits buy";

/** Printed when `quote.sufficient` is false. The shortfall is arithmetic on
 *  two numbers the server already returned (quote total, current balance),
 *  not a price the CLI derives — pricing itself stays server-owned. */
export function formatInsufficientMessage(quote: ArchiveQuote): string {
	const shortfallUsd = (
		(quote.usdMicros - quote.balanceUsdMicros) /
		1_000_000
	).toFixed(2);
	const balanceUsd = (quote.balanceUsdMicros / 1_000_000).toFixed(2);
	return `Insufficient archive credits: quote $${quote.usd}, balance $${balanceUsd}, short $${shortfallUsd}. Buy more with \`${BUY_CREDITS_COMMAND}\`.`;
}

/** Only reachable against a misconfigured host (R2 env unset server-side). */
export const ARCHIVE_GATE_NOT_CONFIGURED_MESSAGE =
	"the archive gate is not configured on the server; contact the operator";

/**
 * Total monthly free-repair allowance, in range-bundles — display only,
 * mirrors `ALLOWANCE_MONTHLY_PARTITIONS / 3` in `routes/archive.ts`. The
 * server remains the sole source of the REMAINING count and of every dollar
 * figure; this constant only lets the CLI print "of 6" without echoing back
 * a number the server already sent.
 */
const ALLOWANCE_MONTHLY_BUNDLES = 6;

/**
 * The value half of the quote line printed into a command's existing plan
 * output (bootstrap's coverage block, repair's plan note) — callers supply
 * the key/label themselves so this stays free of any one command's layout.
 */
export function formatQuoteValue(
	quote: ArchiveQuote,
	flow: ArchiveFlow,
): string {
	if (
		flow === "repair" &&
		quote.usdMicros === 0 &&
		quote.freeAllowanceAppliedMicros > 0
	) {
		return `free (${quote.allowanceRemainingBundles} of ${ALLOWANCE_MONTHLY_BUNDLES} monthly repair fetches remaining)`;
	}
	const balance = `$${(quote.balanceUsdMicros / 1_000_000).toFixed(2)}`;
	return `${quote.partitions} partitions ≈ $${quote.usd} · balance ${balance}`;
}

/**
 * Whether confirmation is still owed before a gated fetch proceeds. The
 * quote itself is computed and printed UNCONDITIONALLY, before this is ever
 * consulted; only `-y` skips the prompt, never the quote print or the
 * sufficiency check (DX contract #1: quote before charge, always).
 *
 * `--json` changes the output shape, not consent: without `-y` a JSON caller
 * gets a `CONFIRMATION_REQUIRED` payload (`confirmationRequiredPayload`) and
 * exit 2 instead of a charge.
 */
export function shouldPromptForGatedFetch(opts: { yes?: boolean }): boolean {
	return !opts.yes;
}

/** Exit code every command uses when `--json` without `-y` needs consent. */
export const CONFIRMATION_REQUIRED_EXIT = 2;

/**
 * The stdout payload for `--json` without `-y`: the quote the reader would
 * have been asked to approve, so a script can inspect the price and re-run
 * with `-y`. `quote` is `null` for an unmetered archive.
 */
export function confirmationRequiredPayload(quote: ArchiveQuote | null): {
	code: "CONFIRMATION_REQUIRED";
	message: string;
	quote: ArchiveQuote | null;
} {
	return {
		code: "CONFIRMATION_REQUIRED",
		message:
			"Nothing was fetched. Re-run with -y to approve this fetch; --json never stands in for -y.",
		quote,
	};
}

/**
 * `fetchVerifiedPartition`'s gate parameter shape — kept structural (no
 * import from `archive-reference.ts`) so the two modules stay decoupled.
 * `forceRefresh` backs expiry recovery: the caller sets it after a
 * downstream 403 on a previously-returned URL, to bypass this fetcher's
 * cache and force a fresh presign.
 */
export type ArchiveGate = {
	getUrl(path: string, opts?: { forceRefresh?: boolean }): Promise<string>;
};

/** URLs page in batches of 16, not the server's max of 64: presigned URLs
 *  expire in 900s (`ARCHIVE_PRESIGN_TTL_SECONDS`) and events partitions COPY
 *  slowly, so a batch must be fully consumable within the TTL. If real
 *  restores show URL expiry churn, lower this further. */
const FETCH_BATCH_SIZE = 16;

/** A cached URL with less than this long to live is re-issued before it is
 *  handed out, so a slow COPY never starts a download on a URL that expires
 *  mid-transfer. Re-issue is free inside the server's 24h window. */
export const PRESIGN_REFRESH_MARGIN_MS = 60_000;

type CachedUrl = { url: string; expiresAt: number | null };

/**
 * Build a lazy, paged URL source over `paths`: the first `getUrl` for an
 * un-fetched batch of 16 triggers that batch's charge+presign; every other
 * path in the batch is then served from cache with no further network call.
 *
 * `paths` must be in consumption order. The batches are contiguous slices,
 * so a caller that lists paths the way it loads them gets each batch charged
 * right before its bytes are used, and no URL sits expiring behind a
 * long-running earlier batch.
 */
export function createGatedFetcher(
	paths: string[],
	flow: ArchiveFlow,
	deps: ArchiveGateDeps = defaultDeps,
	now: () => number = Date.now,
): ArchiveGate {
	const cache = new Map<string, CachedUrl>();
	const batchOf = new Map<string, number>();
	for (const [index, path] of paths.entries()) {
		batchOf.set(path, Math.floor(index / FETCH_BATCH_SIZE));
	}
	const fetchedBatches = new Set<number>();
	const inFlight = new Map<number, Promise<void>>();

	async function fetchAndCache(batchPaths: string[]): Promise<void> {
		const body = await deps.httpArchiveOps<FetchResponseBody>(
			"/api/archive/fetch",
			{ method: "POST", body: { paths: batchPaths, flow } },
		);
		for (const u of body.urls) {
			const parsed = Date.parse(u.expires_at);
			cache.set(u.path, {
				url: u.url,
				expiresAt: Number.isFinite(parsed) ? parsed : null,
			});
		}
	}

	async function reissue(path: string, why: string): Promise<string> {
		// Re-issuing is free within the server's 24h re-issue window for an
		// already-charged path, so this never double-charges. It is noisy,
		// not costly, which is why churn gets a debug line rather than a
		// warning.
		if (process.env.DEBUG) {
			console.error(`[archive-gate] re-issuing ${why} URL for ${path}`);
		}
		await fetchAndCache([path]);
		const fresh = cache.get(path);
		if (!fresh) {
			throw new Error(`archive gate: no URL returned for ${path}`);
		}
		return fresh.url;
	}

	return {
		async getUrl(path, opts) {
			if (opts?.forceRefresh) {
				// Expiry recovery: the cached URL 403'd downstream.
				return reissue(path, "expired");
			}

			const batchIndex = batchOf.get(path);
			if (batchIndex === undefined) {
				throw new Error(`archive gate: ${path} was not in the quoted batch`);
			}
			if (!fetchedBatches.has(batchIndex)) {
				let inflight = inFlight.get(batchIndex);
				if (!inflight) {
					const batchPaths = paths.filter((p) => batchOf.get(p) === batchIndex);
					inflight = fetchAndCache(batchPaths).then(() => {
						fetchedBatches.add(batchIndex);
					});
					inFlight.set(batchIndex, inflight);
				}
				await inflight;
			}
			const cached = cache.get(path);
			if (!cached) {
				throw new Error(`archive gate: no URL returned for ${path}`);
			}
			if (
				cached.expiresAt !== null &&
				cached.expiresAt - now() < PRESIGN_REFRESH_MARGIN_MS
			) {
				return reissue(path, "expiring");
			}
			return cached.url;
		},
	};
}
