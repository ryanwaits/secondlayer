import { DECODER_EVENT_TYPES } from "@secondlayer/indexer/decode/health";
import {
	type IndexerStreamsTipBlock,
	getCurrentCanonicalTip,
	getFinalizedStacksHeight,
} from "@secondlayer/indexer/streams-tip";
import {
	DEFAULT_BTC_CONFIRMATIONS,
	committedHeight,
	finalizedBurnHeight,
} from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { isOssMode } from "@secondlayer/shared/mode";
import type { Kysely } from "kysely";

export type IndexTip = {
	block_height: number;
	/**
	 * Highest Stacks height treated as immutable: blocks at or below this are
	 * past the burn-confirmation finality boundary and safe to cache forever.
	 * Derived from the canonical burn tip, NOT the decoded tip — the decoded
	 * `block_height` can lag below this while the decoder catches up.
	 */
	finalized_height: number;
	lag_seconds: number;
	/**
	 * Canonical source (ingest) tip. VM Index reads clamp here: `vm_events`
	 * land with the block, not with the decoder. Omitted in tests that do not
	 * distinguish the two clocks.
	 */
	source_block_height?: number;
	/**
	 * Committed height per classic decoded-event type (the always-on
	 * decode.<type>.v1 family — ft/nft transfer, stx transfer/mint/burn/lock,
	 * ft/nft mint/burn, print). sbtc/pox4/pox5/bns decoders read separate
	 * tables and are not in this map. `indexReadTip` (index/events.ts) uses it
	 * to sharpen `block_height` to the SPECIFIC type a request reads, instead
	 * of the conservative cross-decoder floor below. Absent on a tip built
	 * without a `readDecodedHeights` reader (e.g. a hand-built test fixture).
	 */
	decoded_heights?: DecodedTypeHeights;
};

/** Zero tip served when no canonical block exists yet (oss/self-host only). */
const EMPTY_INDEX_TIP: IndexTip = {
	block_height: 0,
	finalized_height: 0,
	lag_seconds: 0,
	source_block_height: 0,
	decoded_heights: {},
};

/**
 * Window clamp for source-plane Index reads (`/blocks`, `/transactions`).
 * Envelope `block_height` stays the decoded tip; only the parse window moves.
 */
export function indexSourceWindowTip(tip: IndexTip): IndexTip {
	if (tip.source_block_height === undefined) return tip;
	if (tip.source_block_height === tip.block_height) return tip;
	return { ...tip, block_height: tip.source_block_height };
}

export type IndexFinalizedHeightReader = (
	finalizedBurnHeight: number,
) => Promise<number>;

export type DecodedTipBlock = {
	block_height: number;
	ts: Date;
};

export type IndexTipProvider = () => IndexTip | Promise<IndexTip>;
export type IndexSourceTipReader = () => Promise<IndexerStreamsTipBlock | null>;
export type DecodedTipReader = () => Promise<DecodedTipBlock | null>;

/**
 * Committed height per classic decoded event_type — see `IndexTip.decoded_heights`.
 * `null` means that decoder has no checkpoint yet: distinct from a genuine
 * committed height of 0, and distinct from a missing key (decoder not in this
 * server's build at all). A caller bounding itself by a SPECIFIC type must
 * treat both `null` and "key absent" as unknown/stall — see
 * `committedHeightForEventTypes` and decoder-bound.ts's remote mode.
 */
export type DecodedTypeHeights = Record<string, number | null>;
export type DecodedHeightsReader = () => Promise<DecodedTypeHeights>;

/**
 * Committed height (the shared committed-height rule: sentinel cursor = H
 * done, mid-block = H-1) for every always-on classic decoder, keyed by its
 * public event_type. One indexed `IN` query over the small, fixed decoder
 * set — cheap enough to run on every tip refresh (the same 500ms cache as
 * everything else `createIndexTipProvider` computes).
 *
 * A decoder with no checkpoint row yet (fresh instance, nothing decoded)
 * reports `null`, not 0 — a real caller bounding itself by that specific
 * decoder needs to tell "hasn't started" apart from "committed nothing past
 * genesis", the same distinction local-mode `decoderBoundTip` already makes
 * (`committedHeight(undefined) === null`).
 */
export async function getDecoderCommittedHeights(
	db: Kysely<Database> = getSourceDb(),
): Promise<DecodedTypeHeights> {
	const decoderNames = Object.keys(DECODER_EVENT_TYPES);
	if (decoderNames.length === 0) return {};
	const rows = await db
		.selectFrom("decoder_checkpoints")
		.select(["decoder_name", "last_cursor"])
		.where("decoder_name", "in", decoderNames)
		.execute();
	const cursorByName = new Map(
		rows.map((r) => [r.decoder_name, r.last_cursor]),
	);
	const heights: DecodedTypeHeights = {};
	for (const decoderName of decoderNames) {
		const eventType =
			DECODER_EVENT_TYPES[decoderName as keyof typeof DECODER_EVENT_TYPES];
		heights[eventType] = committedHeight(cursorByName.get(decoderName) ?? null);
	}
	return heights;
}

/**
 * A safe ceiling for ANY subset of classic decoded_events types: the MIN
 * committed height across every one of them. Min-over-a-superset is always
 * ≤ min-over-any-subset, so this floor is correct (never over-serves) no
 * matter which types a given caller actually reads — the property that lets
 * an HTTP-only reader (the chain evaluator, a hosted subgraph) trust it as a
 * FALLBACK block source tip when it can't (or an older server didn't send
 * enough to) narrow to the decoders it actually reads (see
 * decoder-bound.ts's remote mode). Event routes that know their own type
 * sharpen this further via `indexReadTip`/`committedHeightForEventTypes`.
 *
 * A decoder with no checkpoint yet (`null` in the map) counts as height 0
 * here — this is the GLOBAL, caller-agnostic floor, so the conservative
 * choice is to assume the worst rather than have one un-started decoder make
 * the whole tip undefined.
 */
async function getDecoderCommittedTipBlock(
	db: Kysely<Database> = getSourceDb(),
): Promise<DecodedTipBlock | null> {
	const heights = await getDecoderCommittedHeights(db);
	const values = Object.values(heights).map((h) => h ?? 0);
	if (values.length === 0) return null;
	const minHeight = Math.min(...values);

	const block = await db
		.selectFrom("blocks")
		.select(["height", "timestamp"])
		.where("height", "=", minHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (!block) return null;

	return {
		block_height: Number(block.height),
		ts: new Date(Number(block.timestamp) * 1000),
	};
}

/**
 * Last-resort fallback when NO decoder has a checkpoint row at all (a fresh
 * instance whose decoders have never run, or a bulk-import that seeded
 * `decoded_events` without checkpoints). Anchored on ft_transfer specifically
 * — historical default from before per-type committed heights existed — since
 * this only matters for the brief first-boot window before every decoder
 * writes its first checkpoint.
 */
export async function getLatestDecodedTipBlock(
	db: Kysely<Database> = getSourceDb(),
): Promise<DecodedTipBlock | null> {
	const row = await db
		.selectFrom("decoded_events")
		.innerJoin("blocks", "blocks.height", "decoded_events.block_height")
		.select(["decoded_events.block_height", "blocks.timestamp"])
		.where("decoded_events.event_type", "=", "ft_transfer")
		.where("decoded_events.canonical", "=", true)
		.orderBy("decoded_events.block_height", "desc")
		.limit(1)
		.executeTakeFirst();

	if (!row) return null;

	return {
		block_height: Number(row.block_height),
		ts: new Date(Number(row.timestamp) * 1000),
	};
}

/**
 * Bound for a read spanning several decoded event types at once (a future
 * multi-type Index read, or a subgraph-style consumer): the MIN over each
 * type's own committed height, same rule `decoderBoundTip` applies in the
 * subgraph runtime. `null` when the tip carries no `decoded_heights` map
 * (a hand-built fixture) or a requested type isn't in it — callers should
 * treat that as "unknown", not "committed to height 0".
 */
export function committedHeightForEventTypes(
	tip: IndexTip,
	eventTypes: readonly string[],
): number | null {
	if (eventTypes.length === 0) return null;
	const heights = tip.decoded_heights;
	if (!heights) return null;
	const values: number[] = [];
	for (const eventType of eventTypes) {
		const height = heights[eventType];
		if (height === undefined || height === null) return null;
		values.push(height);
	}
	return Math.min(...values);
}

export function getIndexLagSeconds(tipTs: Date, nowMs = Date.now()): number {
	const lagSeconds = Math.round((nowMs - tipTs.getTime()) / 1000);
	return Math.max(0, lagSeconds);
}

export function createIndexTipProvider(opts?: {
	readSourceTip?: IndexSourceTipReader;
	readDecodedTip?: DecodedTipReader;
	/** Per-type committed heights (see `IndexTip.decoded_heights`). Defaults
	 *  to `getDecoderCommittedHeights` — override in tests to avoid a real DB
	 *  read; omitting it there yields `decoded_heights: {}` (unknown), which
	 *  `indexReadTip` treats as "leave block_height alone". */
	readDecodedHeights?: DecodedHeightsReader;
	readFinalizedHeight?: IndexFinalizedHeightReader;
	btcConfirmations?: number;
	now?: () => number;
	cacheTtlMs?: number;
	/**
	 * Serve a zero tip instead of throwing when no canonical block exists.
	 * Defaults to oss mode: a self-hoster with an unindexed DB gets empty
	 * result envelopes rather than a 500, while platform keeps throwing so a
	 * genuinely missing canonical tip surfaces as an incident.
	 */
	allowEmptyTip?: boolean;
}): IndexTipProvider {
	const readSourceTip = opts?.readSourceTip ?? getCurrentCanonicalTip;
	const readDecodedTip =
		opts?.readDecodedTip ??
		(async () => {
			const committedTip = await getDecoderCommittedTipBlock();
			return committedTip ?? (await getLatestDecodedTipBlock());
		});
	const readDecodedHeights =
		opts?.readDecodedHeights ?? (async () => ({}) as DecodedTypeHeights);
	const readFinalizedHeight =
		opts?.readFinalizedHeight ?? getFinalizedStacksHeight;
	const btcConfirmations = opts?.btcConfirmations ?? DEFAULT_BTC_CONFIRMATIONS;
	const now = opts?.now ?? Date.now;
	const cacheTtlMs = opts?.cacheTtlMs ?? 500;
	const allowEmptyTip = opts?.allowEmptyTip ?? isOssMode();
	let cache: { expiresAt: number; value: IndexTip } | null = null;

	return async () => {
		const nowMs = now();
		if (cache && nowMs < cache.expiresAt) return cache.value;

		const sourceTip = await readSourceTip();
		if (!sourceTip) {
			// Self-host with an unindexed DB: empty tip → empty result envelopes,
			// not a 500. Not cached — the tip should appear as soon as a block lands.
			if (allowEmptyTip) return EMPTY_INDEX_TIP;
			throw new Error("Index tip unavailable: no canonical block found");
		}

		// Finality comes from the canonical burn tip, independent of how far the
		// decoder has progressed. block_height tracks the decoded tip, so it may
		// sit below finalized_height — the cache plan clamps to_height by the
		// decoded tip, so finalized pages near the boundary are conservatively
		// served as mutable (never the reverse), which is safe.
		const finalizedBurn = finalizedBurnHeight(
			sourceTip.burn_block_height,
			btcConfirmations,
		);
		// Independent reads off the same snapshot — run concurrently rather than
		// serially stacking three round trips onto every cache-miss tip refresh.
		const [finalized_height, decodedTip, decoded_heights] = await Promise.all([
			readFinalizedHeight(finalizedBurn),
			readDecodedTip(),
			readDecodedHeights(),
		]);
		const tipBlock = decodedTip ?? {
			block_height: sourceTip.block_height,
			ts: sourceTip.ts,
		};
		const value: IndexTip = {
			block_height: tipBlock.block_height,
			finalized_height,
			lag_seconds: getIndexLagSeconds(tipBlock.ts, nowMs),
			source_block_height: sourceTip.block_height,
			decoded_heights,
		};

		cache = { expiresAt: nowMs + cacheTtlMs, value };
		return value;
	};
}

export const getIndexTip = createIndexTipProvider({
	readDecodedHeights: getDecoderCommittedHeights,
});
