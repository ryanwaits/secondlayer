export type BitcoinNetwork = "mainnet" | "testnet";

export interface SpvAdapterRef {
	/** Deployer principal. */
	address: string;
	/** Contract name. */
	name: string;
}

/**
 * Reference `spv-adapter` deployments (the read-only wrapper around the SIP-044
 * built-ins) — the single source of truth for the published adapter principal.
 * Empty until Clarity 6 / Epoch 4.0 activates and the contract is deployed; drop
 * the real principal in here at that point (deploy recipe: `contracts/README.md`).
 * Until then, `verifyBitcoinPayment` requires an explicit `contract`.
 */
export const SPV_ADAPTER_CONTRACTS: Partial<
	Record<BitcoinNetwork, SpvAdapterRef>
> = {
	// mainnet: { address: "SP...", name: "spv-adapter" }, // pending plan 013 deploy
	// testnet: { address: "ST...", name: "spv-adapter" },
};

/** Resolve the reference adapter for a network, or `undefined` if none is deployed yet. */
export function getSpvAdapter(
	network: BitcoinNetwork,
): SpvAdapterRef | undefined {
	return SPV_ADAPTER_CONTRACTS[network];
}

/** A `"address.name"` contract principal from an adapter ref. */
export function spvAdapterPrincipal(ref: SpvAdapterRef): string {
	return `${ref.address}.${ref.name}`;
}
