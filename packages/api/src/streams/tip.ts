import {
	getCurrentCanonicalTip,
	type IndexerStreamsTipBlock,
} from "@secondlayer/indexer/streams-tip";

export type StreamsTip = {
	block_height: number;
	index_block_hash: string;
	burn_block_height: number;
	lag_seconds: number;
};

export type StreamsTipProvider = () => StreamsTip | Promise<StreamsTip>;
export type StreamsTipBlockReader = () => Promise<IndexerStreamsTipBlock | null>;

export type StreamsTipProviderOptions = {
	readTip?: StreamsTipBlockReader;
	now?: () => number;
	cacheTtlMs?: number;
};

export const DEFAULT_STREAMS_TIP: StreamsTip = {
	block_height: 182_447,
	index_block_hash:
		"0x0000000000000000000000000000000000000000000000000000000000000000",
	burn_block_height: 871_249,
	lag_seconds: 0,
};

export const getStubStreamsTip: StreamsTipProvider = () => ({
	...DEFAULT_STREAMS_TIP,
	block_height: Number(
		process.env.STREAMS_STUB_TIP_HEIGHT ?? DEFAULT_STREAMS_TIP.block_height,
	),
});

export function getLagSeconds(tipTs: Date, nowMs = Date.now()): number {
	const lagSeconds = Math.round((nowMs - tipTs.getTime()) / 1000);
	return Math.max(0, lagSeconds);
}

export function createStreamsTipProvider(
	opts: StreamsTipProviderOptions = {},
): StreamsTipProvider {
	const readTip = opts.readTip ?? getCurrentCanonicalTip;
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

		const value: StreamsTip = {
			block_height: tip.block_height,
			index_block_hash: tip.index_block_hash,
			burn_block_height: tip.burn_block_height,
			lag_seconds: getLagSeconds(tip.ts, nowMs),
		};

		// TODO: invalidate from indexer block notifications instead of TTL polling.
		cache = { expiresAt: nowMs + cacheTtlMs, value };
		return value;
	};
}

export const getStreamsTip = createStreamsTipProvider();
