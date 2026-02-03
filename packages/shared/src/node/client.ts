
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
    this.rpcUrl = rpcUrl || process.env.STACKS_NODE_RPC_URL || "http://localhost:20443";
  }

  async getInfo(): Promise<NodeInfo> {
    const res = await fetch(`${this.rpcUrl}/v2/info`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Node RPC /v2/info returned ${res.status}`);
    }
    return res.json() as Promise<NodeInfo>;
  }

  async getBlock(height: number): Promise<BlockResponse | null> {
    // Stacks API v2 block-by-height endpoint
    const res = await fetch(`${this.rpcUrl}/v2/blocks/${height}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Node RPC /v2/blocks/${height} returned ${res.status}`);
    }
    return res.json() as Promise<BlockResponse>;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const info = await this.getInfo();
      return info.stacks_tip_height > 0;
    } catch {
      return false;
    }
  }

  getRpcUrl(): string {
    return this.rpcUrl;
  }
}
