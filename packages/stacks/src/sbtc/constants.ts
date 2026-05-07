/**
 * sBTC mainnet contract identifiers.
 *
 * The protocol uses three contracts:
 * - `sbtc-token` — SIP-010 fungible token with mint/burn/transfer SIP-005 events.
 * - `sbtc-deposit` — entry point for deposit completion calls (no print events).
 * - `sbtc-registry` — emits all protocol-state print events (deposits, withdrawals,
 *   signer-set rotations, governance).
 *
 * Verified against the deployed mainnet contracts via Hiro's
 * `/v2/contracts/source/...` endpoint.
 */
export const SBTC_CONTRACTS = {
	mainnet: {
		address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
		token: "sbtc-token",
		deposit: "sbtc-deposit",
		registry: "sbtc-registry",
	},
	testnet: {
		address: "SN3R84XZYA63QS28932XQF3G1J8R9PC3W76P9CSQS",
		token: "sbtc-token",
		deposit: "sbtc-deposit",
		registry: "sbtc-registry",
	},
} as const;

export type SbtcNetwork = keyof typeof SBTC_CONTRACTS;

/** Asset identifier for `sbtc-token` (mainnet). */
export const SBTC_ASSET_IDENTIFIER_MAINNET: string = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.token}::sbtc-token`;

/** Asset identifier for `sbtc-token` (testnet). */
export const SBTC_ASSET_IDENTIFIER_TESTNET: string = `${SBTC_CONTRACTS.testnet.address}.${SBTC_CONTRACTS.testnet.token}::sbtc-token`;

/** All print-event topic strings emitted by `sbtc-registry`. */
export const SBTC_EVENT_TOPICS = [
	"completed-deposit",
	"withdrawal-create",
	"withdrawal-accept",
	"withdrawal-reject",
	"key-rotation",
	"update-protocol-contract",
] as const;

export type SbtcEventTopic = (typeof SBTC_EVENT_TOPICS)[number];

/** Bitcoin address version bytes used in BTC recipient tuples. Same byte map as PoX. */
export const SBTC_BTC_ADDRESS_VERSION = {
	p2pkh: 0x00,
	p2sh: 0x01,
	p2sh_p2wpkh: 0x02,
	p2sh_p2wsh: 0x03,
	p2wpkh: 0x04,
	p2wsh: 0x05,
	p2tr: 0x06,
} as const;

/** Number of decimal places in the sBTC fungible token (matches BTC). */
export const SBTC_DECIMALS = 8;

/** Smallest unit of sBTC, denominated in satoshis. */
export const SBTC_UNIT_NAME = "satoshis" as const;

/**
 * Resolve the qualified contract identifier for a given protocol contract.
 *
 * @example
 * sbtcContractId("mainnet", "registry")
 * // => "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry"
 */
export function sbtcContractId(
	network: SbtcNetwork,
	contract: "token" | "deposit" | "registry",
): string {
	const cfg = SBTC_CONTRACTS[network];
	return `${cfg.address}.${cfg[contract]}`;
}
