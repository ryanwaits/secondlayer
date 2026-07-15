import { getContract, resolveNetworkContract } from "../actions/getContract.ts";
import { publicKeyToP2trAddress } from "../bitcoin/address.ts";
import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import type { Client } from "../clients/types.ts";
import { SBTC_REGISTRY_ABI, SBTC_TOKEN_ABI } from "./abi.ts";
import { SBTC_CONTRACTS } from "./constants.ts";

function getTokenContract(client: Client) {
	const contract = resolveNetworkContract(client, SBTC_CONTRACTS);
	return getContract({
		client,
		address: contract.address,
		name: contract.token,
		abi: SBTC_TOKEN_ABI,
	});
}

function getRegistryContract(client: Client) {
	const contract = resolveNetworkContract(client, SBTC_CONTRACTS);
	return getContract({
		client,
		address: contract.address,
		name: contract.registry,
		abi: SBTC_REGISTRY_ABI,
	});
}

/** Bitcoin network for the client's chain — devnet/mocknet map to regtest. */
function bitcoinNetworkFromChain(client: Client): BitcoinNetwork {
	const chain = client.chain;
	if (!chain) throw new Error("Client must have a chain configured");
	if (chain.network === "mainnet") return "mainnet";
	// Devnet/mocknet run against bitcoind regtest (network magic "id").
	return chain.magicBytes === "id" ? "regtest" : "testnet";
}

/** Total sBTC supply, in satoshis. */
export async function getTotalSupply(client: Client): Promise<bigint> {
	const token = getTokenContract(client);
	return (await token.read.getTotalSupply({})) as bigint;
}

/** sBTC balance of a Stacks principal, in satoshis. */
export async function getBalance(
	client: Client,
	owner: string,
): Promise<bigint> {
	const token = getTokenContract(client);
	return (await token.read.getBalance({ owner })) as bigint;
}

/** Token name (`sBTC` for the canonical mainnet token). */
export async function getName(client: Client): Promise<string> {
	const token = getTokenContract(client);
	return (await token.read.getName({})) as string;
}

/** Token symbol. */
export async function getSymbol(client: Client): Promise<string> {
	const token = getTokenContract(client);
	return (await token.read.getSymbol({})) as string;
}

/** Number of decimals reported by `sbtc-token` (8 — matches BTC). */
export async function getDecimals(client: Client): Promise<bigint> {
	const token = getTokenContract(client);
	return (await token.read.getDecimals({})) as bigint;
}

/** Optional metadata URI returned by the token contract. */
export async function getTokenUri(client: Client): Promise<string | null> {
	const token = getTokenContract(client);
	return (await token.read.getTokenUri({})) as string | null;
}

/**
 * Current signer-set aggregate public key (33-byte compressed), read from
 * `sbtc-registry`.
 */
export async function getSignersPublicKey(client: Client): Promise<Uint8Array> {
	const registry = getRegistryContract(client);
	const pubkey = (await registry.read.getCurrentAggregatePubkey(
		{},
	)) as Uint8Array;
	if (!pubkey || pubkey.length !== 33 || pubkey.every((b) => b === 0)) {
		throw new Error(
			"sbtc-registry returned no aggregate pubkey (signer set not yet rotated in on this network)",
		);
	}
	return pubkey;
}

/**
 * The signers' taproot deposit address, derived from the current aggregate
 * pubkey. Network-aware: encodes `bc1p…` / `tb1p…` / `bcrt1p…` from the
 * client's chain.
 */
export async function getSignersAddress(client: Client): Promise<string> {
	const pubkey = await getSignersPublicKey(client);
	return publicKeyToP2trAddress(pubkey, bitcoinNetworkFromChain(client));
}
