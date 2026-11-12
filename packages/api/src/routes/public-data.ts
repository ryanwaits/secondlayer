import { type Context, Hono } from "hono";
import { getBitcoinTip } from "../bitcoin/db.ts";
import {
	type Pox5Cycle,
	type Pox5CycleSigner,
	getPoxCyclesResponse,
	readPoxCycle,
	readTipBurnHeight,
} from "../index/pox-cycles.ts";
import { type RuneEntry, readRunes } from "../index/runes.ts";
import {
	type SbtcSummaryResponse,
	getSbtcSummaryResponse,
} from "../index/sbtc-peg.ts";
import { type IndexTip, getIndexTip } from "../index/tip.ts";

/**
 * Keyless aggregates behind the public /data/sbtc, /data/pox5 and /data/runes
 * pages.
 *
 * Aggregates only, never a filterable list of rows: the sBTC scoreboard, the
 * PoX-5 current and next cycle plus the current cycle's signers (tens of rows
 * from the materialized rollup), and the ten most-minted runes. The pages are public and indexed, so request
 * volume must never reach the database: each payload is read at most once per
 * `ttlMs` per process, concurrent requests share one read, and a failed read
 * is not cached.
 */
export type PublicDataTip = Pick<IndexTip, "block_height" | "lag_seconds">;

export type PublicSbtcData = {
	summary: SbtcSummaryResponse["summary"];
	tip: PublicDataTip;
	generated_at: string;
};

export type PublicPoxData = {
	/** Null before the first pox-5 cycle starts. */
	current: Pox5Cycle | null;
	next: Pox5Cycle | null;
	/** The current cycle's signers, largest delegation first. */
	signers: Pox5CycleSigner[];
	tip: PublicDataTip;
	generated_at: string;
};

/** The catalog fields the Runes page reads; the rest stay behind a key. */
export type PublicRune = Pick<
	RuneEntry,
	"id" | "spaced_name" | "symbol" | "mints" | "supply" | "divisibility"
>;

export type PublicRunesData = {
	/** The ten most-minted runes, most first. */
	most_minted: PublicRune[];
	/** Bitcoin block height, a separate clock from the Stacks tip. */
	tip: { block_height: number };
	generated_at: string;
};

export type PublicDataOptions = {
	readSbtc?: () => Promise<PublicSbtcData>;
	readPox?: () => Promise<PublicPoxData>;
	readRunes?: () => Promise<PublicRunesData>;
	now?: () => number;
	ttlMs?: number;
};

const TTL_MS = 60_000;

/** Run `read` at most once per `ttlMs`; null when it fails (not cached). */
export function createMemoizedReader<T>(
	read: () => Promise<T>,
	{
		now = Date.now,
		ttlMs = TTL_MS,
	}: { now?: () => number; ttlMs?: number } = {},
): () => Promise<T | null> {
	let cached: { at: number; value: T } | null = null;
	let inflight: Promise<T | null> | null = null;
	return () => {
		if (cached && now() - cached.at < ttlMs)
			return Promise.resolve(cached.value);
		if (inflight) return inflight;
		inflight = read()
			.then((value): T | null => {
				cached = { at: now(), value };
				return value;
			})
			.catch((): T | null => null)
			.then((value) => {
				inflight = null;
				return value;
			});
		return inflight;
	};
}

function publicTip(tip: IndexTip): PublicDataTip {
	return { block_height: tip.block_height, lag_seconds: tip.lag_seconds };
}

async function readSbtcData(): Promise<PublicSbtcData> {
	const tip = await getIndexTip();
	const { summary } = await getSbtcSummaryResponse({ tip });
	return {
		summary,
		tip: publicTip(tip),
		generated_at: new Date().toISOString(),
	};
}

function byDelegationDesc(a: Pox5CycleSigner, b: Pox5CycleSigner): number {
	const diff = BigInt(b.delegated_ustx) - BigInt(a.delegated_ustx);
	if (diff !== 0n) return diff > 0n ? 1 : -1;
	return a.signer.localeCompare(b.signer);
}

async function readPoxData(): Promise<PublicPoxData> {
	const tip = await getIndexTip();
	const tipBurnHeight = await readTipBurnHeight(tip);
	// No cursor: the list starts at the next cycle, so limit 2 is next + current.
	const { cycles } = await getPoxCyclesResponse({
		query: new URLSearchParams({ limit: "2" }),
		tip,
		tipBurnHeight,
	});
	const current = cycles.find((cycle) => cycle.is_current) ?? null;
	const next = current
		? (cycles.find((c) => c.reward_cycle === current.reward_cycle + 1) ?? null)
		: null;
	const detail = current ? await readPoxCycle(current.reward_cycle) : null;
	return {
		current,
		next,
		signers: [...(detail?.signers ?? [])].sort(byDelegationDesc),
		tip: publicTip(tip),
		generated_at: new Date().toISOString(),
	};
}

const MOST_MINTED_LIMIT = 10;

async function readRunesData(): Promise<PublicRunesData> {
	const [tip, { runes }] = await Promise.all([
		getBitcoinTip(),
		readRunes({ sort: "mints", limit: MOST_MINTED_LIMIT }),
	]);
	// A bitcoin database that was never migrated reads as height 0: not data.
	if (tip.block_height === 0) throw new Error("runes not indexed");
	return {
		most_minted: runes.map(
			({ id, spaced_name, symbol, mints, supply, divisibility }) => ({
				id,
				spaced_name,
				symbol,
				mints,
				supply,
				divisibility,
			}),
		),
		tip: { block_height: tip.block_height },
		generated_at: new Date().toISOString(),
	};
}

export function createPublicDataRouter(opts: PublicDataOptions = {}) {
	const app = new Hono();
	const memo = { now: opts.now, ttlMs: opts.ttlMs };
	const sbtc = createMemoizedReader(opts.readSbtc ?? readSbtcData, memo);
	const pox = createMemoizedReader(opts.readPox ?? readPoxData, memo);

	const runes = createMemoizedReader(opts.readRunes ?? readRunesData, memo);

	const serve = (read: () => Promise<unknown>) => async (c: Context) => {
		const body = await read();
		if (!body) {
			c.header("Cache-Control", "no-store");
			return c.json({ error: "unavailable" }, 503);
		}
		c.header("Cache-Control", "public, max-age=60, s-maxage=60");
		return c.json(body);
	};

	app.get("/public/data/sbtc", serve(sbtc));
	app.get("/public/data/pox", serve(pox));
	app.get("/public/data/runes", serve(runes));
	return app;
}

export default createPublicDataRouter();
