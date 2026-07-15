import type { Client } from "../../clients/types.ts";
import { HttpRequestError } from "../../errors/http.ts";

export type GetRawBlockParams = {
	height: number;
};

/**
 * Raw node RPC block shape (`/v2/blocks/{height}`) — distinct from
 * {@link getBlock}'s Hiro extended-API shape. Carries consensus/identity
 * fields (`index_block_hash`, `miner_txid`, ...) that the indexed API doesn't
 * expose, for trust-minimized use cases (e.g. block-header proofs) that can't
 * rely on a third-party indexer.
 */
export type RawBlockResponse = {
	hash: string;
	height: number;
	parent_block_hash: string;
	burn_block_height: number;
	burn_block_hash: string;
	burn_block_time: number;
	index_block_hash: string;
	parent_index_block_hash: string;
	miner_txid: string;
	txs: string[];
};

/**
 * Fetch a block by height directly from a stacks-node (not Hiro's extended
 * API — see {@link getBlock} for that). Returns `null` when the node has no
 * block at that height.
 */
export async function getRawBlock(
	client: Client,
	params: GetRawBlockParams,
): Promise<RawBlockResponse | null> {
	try {
		const data = (await client.request(`/v2/blocks/${params.height}`, {
			method: "GET",
		})) as Partial<RawBlockResponse> | undefined;
		return data?.hash ? (data as RawBlockResponse) : null;
	} catch (error) {
		if (error instanceof HttpRequestError && error.status === 404) return null;
		throw error;
	}
}
