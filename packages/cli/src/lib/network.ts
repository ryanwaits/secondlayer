export const CHAIN_IDS = {
	mainnet: { hex: "0x00000001", decimal: 1 },
	testnet: { hex: "0x80000000", decimal: 2147483648 },
} as const;

export type Network = keyof typeof CHAIN_IDS;

export function getChainIdHex(network: Network): string {
	return CHAIN_IDS[network].hex;
}

/**
 * Map RPC network_id to network name.
 * Stacks RPC returns network_id = 1 for mainnet, 2147483648 for testnet.
 */
export function networkFromId(networkId: number): Network | null {
	if (networkId === CHAIN_IDS.mainnet.decimal) return "mainnet";
	if (networkId === CHAIN_IDS.testnet.decimal) return "testnet";
	return null;
}
