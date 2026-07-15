import { http, createPublicClient } from "@secondlayer/stacks";
import { getContractAbi, getRawBlock } from "@secondlayer/stacks/actions";
import type { RewardSet } from "./consensus.ts";
import {
	type NakamotoBlockHeader,
	nakamotoBlockHash,
	nakamotoBlockId,
	parseNakamotoBlockHeader,
} from "./nakamoto.ts";

export interface NodeInfo {
	peer_version: number;
	pox_consensus: string;
	burn_block_height: number;
	stable_pox_consensus: string;
	stable_burn_block_height: number;
	server_version: string;
	network_id: number;
	parent_network_id: number;
	stacks_tip_height: number;
	stacks_tip: string;
	stacks_tip_consensus_hash: string;
	genesis_chainstate_hash: string;
}

export interface BlockResponse {
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
	// Full block data varies by endpoint — kept minimal for fetch use case
}

export class StacksNodeClient {
	private rpcUrl: string;

	constructor(rpcUrl?: string) {
		this.rpcUrl =
			rpcUrl || process.env.STACKS_NODE_RPC_URL || "http://localhost:20443";
	}

	/**
	 * A stacks-backed client for the given call's original timeout, with no
	 * retries — matches every method's prior single-attempt fetch semantics
	 * (in particular `getInfo`'s fast-fail timing, which `isHealthy()` and its
	 * callers depend on).
	 */
	private client(timeoutMs: number) {
		return createPublicClient({
			transport: http(this.rpcUrl, { retryCount: 0, timeout: timeoutMs }),
		});
	}

	async getInfo(): Promise<NodeInfo> {
		const data = await this.client(10_000).request("/v2/info", {
			method: "GET",
		});
		return data as NodeInfo;
	}

	async getBlock(height: number): Promise<BlockResponse | null> {
		return getRawBlock(this.client(30_000), { height });
	}

	/**
	 * Fetch + parse a Nakamoto block by its index_block_hash. Returns the raw
	 * bytes, the parsed header, and the recomputed block_hash / index_block_hash
	 * (so a caller can cross-check the node's answer). Null on 404.
	 */
	async getNakamotoBlock(blockId: string): Promise<{
		raw: Uint8Array;
		header: NakamotoBlockHeader;
		blockHash: string;
		indexBlockHash: string;
	} | null> {
		const id = blockId.startsWith("0x") ? blockId.slice(2) : blockId;
		const res = await fetch(`${this.rpcUrl}/v3/blocks/${id}`, {
			signal: AbortSignal.timeout(30_000),
		});
		if (res.status === 404) return null;
		if (!res.ok) {
			throw new Error(`Node RPC /v3/blocks/${id} returned ${res.status}`);
		}
		const raw = new Uint8Array(await res.arrayBuffer());
		const header = parseNakamotoBlockHeader(raw);
		const blockHash = nakamotoBlockHash(header);
		return {
			raw,
			header,
			blockHash,
			indexBlockHash: nakamotoBlockId(blockHash, header.consensusHash),
		};
	}

	/**
	 * Fetch the reward set (signer keys + weights) for a reward cycle from
	 * `/v3/stacker_set/{cycle}`. Null on 404 (cycle not yet computed).
	 */
	async getRewardSet(cycle: number): Promise<RewardSet | null> {
		const res = await fetch(`${this.rpcUrl}/v3/stacker_set/${cycle}`, {
			signal: AbortSignal.timeout(15_000),
		});
		if (res.status === 404) return null;
		if (!res.ok) {
			throw new Error(
				`Node RPC /v3/stacker_set/${cycle} returned ${res.status}`,
			);
		}
		const body = (await res.json()) as {
			stacker_set: { signers: { signing_key: string; weight: number }[] };
		};
		const signers = body.stacker_set.signers.map((s) => ({
			signing_key: s.signing_key.startsWith("0x")
				? s.signing_key.slice(2)
				: s.signing_key,
			weight: s.weight,
		}));
		return {
			signers,
			total_weight: signers.reduce((sum, s) => sum + s.weight, 0),
		};
	}

	async isHealthy(): Promise<boolean> {
		try {
			const info = await this.getInfo();
			return info.stacks_tip_height > 0;
		} catch {
			return false;
		}
	}

	async getContractAbi(contractId: string): Promise<unknown> {
		return getContractAbi(this.client(30_000), { contract: contractId });
	}

	getRpcUrl(): string {
		return this.rpcUrl;
	}
}
