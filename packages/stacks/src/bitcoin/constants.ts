export type BitcoinNetwork = "mainnet" | "testnet";

export interface SpvAdapterRef {
	/** Deployer principal. */
	address: string;
	/** Contract name. */
	name: string;
}

/**
 * Reference `spv-adapter` deployments (the read-only wrapper around the SIP-044
 * built-ins). Populated by plan 013 once Clarity 6 / Epoch 4.0 activates and the
 * contract is deployed. Until then this is empty and callers must pass an
 * explicit `contract` to `bitcoinVerifier`.
 */
export const SPV_ADAPTER_CONTRACTS: Partial<
	Record<BitcoinNetwork, SpvAdapterRef>
> = {
	// mainnet: { address: "SP...", name: "spv-adapter" }, // pending plan 013 deploy
	// testnet: { address: "ST...", name: "spv-adapter" },
};
