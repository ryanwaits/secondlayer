/** Independent explorers for cross-checking a verified block. The only place their hosts live. */

const strip0x = (hex: string) => hex.replace(/^0x/i, "");

/** Stacks block page, keyed by the index block hash. */
export function stacksBlockUrl(blockId: string): string {
	return `https://explorer.hiro.so/block/0x${strip0x(blockId)}?chain=mainnet`;
}

/** Bitcoin block page, keyed by block hash. */
export function bitcoinBlockUrl(hash: string): string {
	return `https://mempool.space/block/${strip0x(hash)}`;
}

/** Bitcoin block page, keyed by height (mempool.space redirects to the block). */
export function bitcoinHeightUrl(height: number): string {
	return `https://mempool.space/block/${height}`;
}

/** The CLI command that repeats the check on the reader's machine. */
export function rerunCommand(
	ref: number | string,
	belowCheckpoint: boolean,
): string {
	const base = `bunx @secondlayer/cli verify block ${ref}`;
	return belowCheckpoint ? base : `${base} --node http://<your-node>:20443`;
}
