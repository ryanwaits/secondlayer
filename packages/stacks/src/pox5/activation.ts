import type { Client } from "../clients/types.ts";
import { POX5_CONTRACT_NAME } from "./constants.ts";

/**
 * Chain-reported PoX-5 activation facts, read from the node's `/v2/pox`
 * `contract_versions[]`. Present the moment nodes run stacks-core >= 4.0.0 —
 * no hardcoded heights, works on any network.
 */
export type Pox5Activation = {
	/** Fully-qualified `pox-5` contract id (boot address differs per network). */
	contractId: string;
	/** Bitcoin block height at which Epoch 4.0 (and pox-5) activates. */
	activationBurnchainBlockHeight: number;
	/** First reward cycle in which pox-5 governs PoX. */
	firstRewardCycleId: number;
};

type PoxInfoResponse = {
	current_burnchain_block_height?: number;
	contract_versions?: Array<{
		contract_id: string;
		activation_burnchain_block_height: number;
		first_reward_cycle_id: number;
	}>;
};

/**
 * Read pox-5's activation entry from the node. Returns `undefined` when the
 * node doesn't know about pox-5 yet (pre-4.0.0 node software).
 */
export async function getPox5Activation(
	client: Client,
): Promise<Pox5Activation | undefined> {
	const info = (await client.request("/v2/pox", {
		method: "GET",
	})) as PoxInfoResponse;
	const entry = info.contract_versions?.find((v) =>
		v.contract_id.endsWith(`.${POX5_CONTRACT_NAME}`),
	);
	if (!entry) return undefined;
	return {
		contractId: entry.contract_id,
		activationBurnchainBlockHeight: entry.activation_burnchain_block_height,
		firstRewardCycleId: entry.first_reward_cycle_id,
	};
}

/**
 * Whether pox-5 is live on the node's chain: the node software knows the
 * contract AND the burnchain has reached its activation height. One request.
 */
export async function isPox5Active(client: Client): Promise<boolean> {
	const info = (await client.request("/v2/pox", {
		method: "GET",
	})) as PoxInfoResponse;
	const entry = info.contract_versions?.find((v) =>
		v.contract_id.endsWith(`.${POX5_CONTRACT_NAME}`),
	);
	if (!entry || typeof info.current_burnchain_block_height !== "number")
		return false;
	return (
		info.current_burnchain_block_height >=
		entry.activation_burnchain_block_height
	);
}

/** Throw a descriptive error unless pox-5 is active on the client's chain. */
export async function assertPox5Active(client: Client): Promise<void> {
	if (!(await isPox5Active(client))) {
		throw new Error(
			"pox-5 is not active on this chain yet (Epoch 4.0 activates at Bitcoin block 960,230 on mainnet, ~2026-07-29). " +
				"Check getPox5Activation(client) for this network's activation height.",
		);
	}
}
