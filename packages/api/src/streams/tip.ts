import {
	type IndexerStreamsTipBlock,
	getCurrentCanonicalTip,
	getFinalizedStacksHeight,
} from "@secondlayer/indexer/streams-tip";
import {
	DEFAULT_BTC_CONFIRMATIONS,
	finalizedBurnHeight,
} from "@secondlayer/shared";
import { logger } from "@secondlayer/shared/logger";
import { listen, sourceListenerUrl } from "@secondlayer/shared/queue/listener";

export type StreamsTip = {
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	/**
	 * Highest Stacks height treated as immutable: blocks at or below this are
	 * past the burn-confirmation finality boundary and safe to cache forever.
	 */
	finalized_height: number;
	lag_seconds: number;
};

export type StreamsTipProvider = () => StreamsTip | Promise<StreamsTip>;
export type StreamsTipBlockReader =
	() => Promise<IndexerStreamsTipBlock | null>;
export type StreamsFinalizedHeightReader = (
	finalizedBurnHeight: number,
) => Promise<number>;

export type StreamsTipProviderOptions = {
	readTip?: StreamsTipBlockReader;
	readFinalizedHeight?: StreamsFinalizedHeightReader;
	btcConfirmations?: number;
	now?: () => number;
	cacheTtlMs?: number;
	/**
	 * Called once, synchronously, at creation with a function that drops this
	 * instance's cached value. Only the process-wide `getStreamsTip` singleton
	 * wires this up (to the `indexer:new_block` NOTIFY, see
	 * `startStreamsTipInvalidationListener`) — a hand-built provider in a test
	 * has no reason to invalidate early and can omit it, leaving `cacheTtlMs`
	 * as the only staleness bound, unchanged from before this option existed.
	 */
	onInvalidate?: (invalidate: () => void) => void;
};

export const DEFAULT_STREAMS_TIP: StreamsTip = {
	block_height: 182_447,
	block_hash:
		"0x0000000000000000000000000000000000000000000000000000000000000000",
	burn_block_height: 871_249,
	finalized_height: 182_447 - 6,
	lag_seconds: 0,
};

export const getStubStreamsTip: StreamsTipProvider = () => {
	const block_height = Number(
		process.env.STREAMS_STUB_TIP_HEIGHT ?? DEFAULT_STREAMS_TIP.block_height,
	);
	return {
		...DEFAULT_STREAMS_TIP,
		block_height,
		finalized_height: Math.max(0, block_height - DEFAULT_BTC_CONFIRMATIONS),
	};
};

export function getLagSeconds(tipTs: Date, nowMs = Date.now()): number {
	const lagSeconds = Math.round((nowMs - tipTs.getTime()) / 1000);
	return Math.max(0, lagSeconds);
}

/**
 * No canonical block exists yet — a freshly booted self-host install whose
 * indexer hasn't ingested anything. Distinct from a server fault: the operator
 * needs "wait for the indexer", not a stack trace.
 */
export class StreamsTipUnavailableError extends Error {
	readonly code = "CHAIN_DATA_UNAVAILABLE";
	constructor() {
		super(
			"No canonical block indexed yet — Streams has nothing to serve. Wait for the indexer to ingest its first block.",
		);
		this.name = "StreamsTipUnavailableError";
	}
}

export function createStreamsTipProvider(
	opts: StreamsTipProviderOptions = {},
): StreamsTipProvider {
	const readTip = opts.readTip ?? getCurrentCanonicalTip;
	const readFinalizedHeight =
		opts.readFinalizedHeight ?? getFinalizedStacksHeight;
	const btcConfirmations = opts.btcConfirmations ?? DEFAULT_BTC_CONFIRMATIONS;
	const now = opts.now ?? Date.now;
	const cacheTtlMs = opts.cacheTtlMs ?? 500;
	let cache: { expiresAt: number; value: StreamsTip } | null = null;
	opts.onInvalidate?.(() => {
		cache = null;
	});

	return async () => {
		const nowMs = now();
		if (cache && nowMs < cache.expiresAt) return cache.value;

		const tip = await readTip();
		if (!tip) {
			throw new StreamsTipUnavailableError();
		}

		const finalizedBurn = finalizedBurnHeight(
			tip.burn_block_height,
			btcConfirmations,
		);
		const finalized_height = await readFinalizedHeight(finalizedBurn);

		const value: StreamsTip = {
			block_height: tip.block_height,
			block_hash: tip.block_hash,
			burn_block_height: tip.burn_block_height,
			finalized_height,
			lag_seconds: getLagSeconds(tip.ts, nowMs),
		};

		cache = { expiresAt: nowMs + cacheTtlMs, value };
		return value;
	};
}

/** Invalidators registered by every `getStreamsTip`-style singleton created
 *  with `onInvalidate` (in practice just the one below — plural only so a
 *  second instance, e.g. in a future entrypoint, doesn't have to reinvent
 *  this). */
const streamsTipInvalidators = new Set<() => void>();

export const getStreamsTip = createStreamsTipProvider({
	onInvalidate: (invalidate) => {
		streamsTipInvalidators.add(invalidate);
	},
});

let streamsTipListenerStarted: Promise<() => Promise<void>> | null = null;

/**
 * Start (once per process) the LISTEN that drops the Streams tip cache the
 * moment a block commits, instead of waiting out `cacheTtlMs` (500ms) on the
 * next request (plan-063 3.3 — the TODO above this used to mark). Call from
 * the api entrypoint; safe to call more than once. Degrades safely: if the
 * LISTEN connection never comes up (or later drops), the tip simply falls
 * back to its normal TTL-refresh behavior — never wrong, just up to
 * `cacheTtlMs` staler than it could be.
 */
export function startStreamsTipInvalidationListener(opts?: {
	connectionString?: string;
}): void {
	if (streamsTipListenerStarted) return;
	streamsTipListenerStarted = listen(
		"indexer:new_block",
		() => {
			for (const invalidate of streamsTipInvalidators) invalidate();
		},
		{ connectionString: opts?.connectionString ?? sourceListenerUrl() },
	).catch((error) => {
		logger.warn(
			"streams tip invalidation listener failed to start — the tip cache still refreshes every cacheTtlMs",
			{ error: error instanceof Error ? error.message : String(error) },
		);
		streamsTipListenerStarted = null;
		return null as unknown as () => Promise<void>;
	});
}
