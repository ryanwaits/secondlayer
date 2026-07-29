export type BitcoinNetwork = "mainnet" | "testnet" | "regtest";

export interface SpvAdapterRef {
	/** Deployer principal. */
	address: string;
	/** Contract name. */
	name: string;
}

/**
 * Reference `spv-adapter` deployments (the read-only wrapper around the SIP-044
 * built-ins) — the single source of truth for the published adapter principal.
 * A network is listed only once its adapter is deployed AND verified against a
 * real Bitcoin header; `verifyBitcoinPayment` requires an explicit `contract`
 * for any network absent here (deploy recipe: `contracts/README.md`).
 *
 * `testnet` is absent because Stacks testnet has no Epoch 4.0 — the SIP-044
 * built-ins do not exist there, so the contract cannot be deployed.
 */
export const SPV_ADAPTER_CONTRACTS: Partial<
	Record<BitcoinNetwork, SpvAdapterRef>
> = {
	mainnet: {
		address: "SP2M1DE95TS0QBM4K893X6ST49FFJ53CCX9CYWNVY",
		name: "spv-adapter",
	},
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
