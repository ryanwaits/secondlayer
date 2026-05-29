import {
	type IndexerStreamsTipBlock,
	getCurrentCanonicalTip,
	getFinalizedStacksHeight,
} from "@secondlayer/indexer/streams-tip";
import {
	DEFAULT_BTC_CONFIRMATIONS,
	finalizedBurnHeight,
} from "@secondlayer/shared";

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

	return async () => {
		const nowMs = now();
		if (cache && nowMs < cache.expiresAt) return cache.value;

		const tip = await readTip();
		if (!tip) {
			throw new Error("Streams tip unavailable: no canonical block found");
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

		// TODO: invalidate from indexer block notifications instead of TTL polling.
		cache = { expiresAt: nowMs + cacheTtlMs, value };
		return value;
	};
}

export const getStreamsTip = createStreamsTipProvider();
