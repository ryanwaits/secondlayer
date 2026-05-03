export type StreamsTip = {
	block_height: number;
	index_block_hash: string;
	burn_block_height: number;
	lag_seconds: number;
};

export type StreamsTipProvider = () => StreamsTip | Promise<StreamsTip>;

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
