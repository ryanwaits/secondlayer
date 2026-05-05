export const DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS = 10_000;
export const DEFAULT_STREAMS_BULK_FINALITY_LAG_BLOCKS = 144;

export type StreamsBulkBlockRange = {
	fromBlock: number;
	toBlock: number;
};

export function requirePositiveInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

export function requireNonNegativeInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

export function validateStreamsBulkRange(
	range: StreamsBulkBlockRange,
): StreamsBulkBlockRange {
	requireNonNegativeInteger(range.fromBlock, "fromBlock");
	requireNonNegativeInteger(range.toBlock, "toBlock");
	if (range.toBlock < range.fromBlock) {
		throw new Error("toBlock must be greater than or equal to fromBlock");
	}
	return range;
}

export function latestCompleteFinalizedRange(params: {
	tipBlockHeight: number;
	rangeSizeBlocks?: number;
	finalityLagBlocks?: number;
}): StreamsBulkBlockRange | null {
	const rangeSizeBlocks = requirePositiveInteger(
		params.rangeSizeBlocks ?? DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS,
		"rangeSizeBlocks",
	);
	const finalityLagBlocks = requireNonNegativeInteger(
		params.finalityLagBlocks ?? DEFAULT_STREAMS_BULK_FINALITY_LAG_BLOCKS,
		"finalityLagBlocks",
	);
	const eligibleTip = params.tipBlockHeight - finalityLagBlocks;
	if (eligibleTip < rangeSizeBlocks - 1) return null;

	const completeRangeCount = Math.floor((eligibleTip + 1) / rangeSizeBlocks);
	const toBlock = completeRangeCount * rangeSizeBlocks - 1;
	return {
		fromBlock: toBlock - rangeSizeBlocks + 1,
		toBlock,
	};
}

export function formatBlockRangeLabel(range: StreamsBulkBlockRange): string {
	validateStreamsBulkRange(range);
	return `${padBlockHeight(range.fromBlock)}-${padBlockHeight(range.toBlock)}`;
}

export function padBlockHeight(height: number): string {
	requireNonNegativeInteger(height, "height");
	return String(height).padStart(10, "0");
}
