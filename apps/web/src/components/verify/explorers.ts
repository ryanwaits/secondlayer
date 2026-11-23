const strip0x = (hex: string) => hex.replace(/^0x/i, "");

export function stacksBlockUrl(blockId: string): string {
	return `https://explorer.hiro.so/block/0x${strip0x(blockId)}?chain=mainnet`;
}

export function stacksTxUrl(txId: string): string {
	return `https://explorer.hiro.so/txid/0x${strip0x(txId)}?chain=mainnet`;
}

export function bitcoinBlockUrl(hash: string): string {
	return `https://mempool.space/block/${strip0x(hash)}`;
}

export function bitcoinHeightUrl(height: number): string {
	return `https://mempool.space/block/${height}`;
}

export function rerunCommand(
	ref: number | string,
	belowCheckpoint: boolean,
): string {
	const base = `bunx @secondlayer/cli verify block ${ref}`;
	return belowCheckpoint ? base : `${base} --node http://<your-node>:20443`;
}
