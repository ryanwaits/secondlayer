import type { Client } from "../clients/types.ts";
import { EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET } from "../epochs.ts";
import { MalformedResponseError } from "../errors/response.ts";

/**
 * SIP-044 (the native Bitcoin SPV built-ins) activates as part of the **Stacks
 * Epoch 4.0 hard fork** — the same fork that ships `pox-5` (SIP-045), so both
 * share one height: {@link EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET}.
 */
export interface Clarity6Gate {
	/**
	 * Bitcoin burn block height at which Clarity 6 / Epoch 4.0 activates.
	 * Optional on a mainnet client, which falls back to the known mainnet
	 * height; required on every other network, where no fixed height exists.
	 */
	activationBurnHeight?: number;
}

/** Read the node's current Bitcoin burn block height from `/v2/info`. */
export async function getBurnBlockHeight(client: Client): Promise<number> {
	const info = (await client.request("/v2/info")) as {
		burn_block_height?: number;
	};
	if (typeof info?.burn_block_height !== "number") {
		throw new MalformedResponseError(
			'getBurnBlockHeight: /v2/info response is missing "burn_block_height"',
		);
	}
	return info.burn_block_height;
}

/**
 * Whether Clarity 6 (the native SPV built-ins) is active on the node behind
 * `client`. Compares the node's current burn height to the SIP-044 / Epoch 4.0
 * activation height: the known mainnet height when `client.chain` is mainnet,
 * otherwise the one you supply. `bitcoinVerifier` uses this to refuse calls
 * before activation rather than failing with an opaque contract error.
 */
export async function isClarity6Active(
	client: Client,
	gate: Clarity6Gate = {},
): Promise<boolean> {
	const activation =
		gate.activationBurnHeight ??
		(client.chain?.network === "mainnet"
			? EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET
			: undefined);
	if (activation == null) {
		throw new Error(
			`Clarity 6 (SIP-044 / Epoch 4.0) has no fixed activation height on ${client.chain?.network ?? "this network"} — pass { activationBurnHeight }`,
		);
	}
	const current = await getBurnBlockHeight(client);
	return current >= activation;
}
