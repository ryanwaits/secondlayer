import { mocknet } from "../chains/definitions.ts";
import type { StacksChain } from "../chains/types.ts";

/**
 * Chain descriptor for a Clarinet simnet session. Address versions match
 * Clarinet's testnet-style accounts (`ST…`). Boot contracts (pox-5, …) still
 * live at their mainnet principals inside the VM.
 */
export const simnetChain: StacksChain = {
	...mocknet,
	name: "Clarinet Simnet",
	rpcUrls: {
		default: { http: ["simnet://clarinet"] },
	},
};
