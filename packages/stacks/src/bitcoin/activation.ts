import type { Client } from "../clients/types.ts";
import { MalformedResponseError } from "../errors/response.ts";

/**
 * SIP-044 (the native Bitcoin SPV built-ins) activates as part of the **Stacks
 * Epoch 4.0 hard fork**. The exact activation Bitcoin block height is only
 * selected after the SIP vote passes, so there is no constant to hardcode — a
 * caller passes it once it is known.
 */
export interface Clarity6Gate {
	/**
	 * Bitcoin burn block height at which Clarity 6 / Epoch 4.0 activates. Pass it
	 * once the vote selects it; until then `isClarity6Active` cannot answer and
	 * throws.
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
 * activation height, which must be supplied (it is unknown until the vote — see
 * `Clarity6Gate`). `bitcoinVerifier` uses this to refuse calls before activation
 * rather than failing with an opaque contract error.
 */
export async function isClarity6Active(
	client: Client,
	gate: Clarity6Gate = {},
): Promise<boolean> {
	if (gate.activationBurnHeight == null) {
		throw new Error(
			"Clarity 6 (SIP-044 / Epoch 4.0) activation burn height is not yet known — pass { activationBurnHeight } once the vote selects it",
		);
	}
	const current = await getBurnBlockHeight(client);
	return current >= gate.activationBurnHeight;
}
