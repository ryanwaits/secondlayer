import { getContract, resolveNetworkContract } from "../actions/getContract.ts";
import { getBurnBlockHeight } from "../bitcoin/activation.ts";
import { publicKeyToP2trAddress } from "../bitcoin/address.ts";
import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import type { Client } from "../clients/types.ts";
import { SBTC_REGISTRY_ABI, SBTC_TOKEN_ABI } from "./abi.ts";
import { SBTC_CONTRACTS } from "./constants.ts";
import {
	SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET,
	assertRegistryAggregateKey,
	deriveSbtcV2PegOutput,
} from "./peg.ts";

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

/** The registry's current signer set (`get-current-signer-data`). */
export interface SbtcSignerSet {
	/** 33-byte compressed signer public keys. */
	signerPublicKeys: Uint8Array[];
	/** Signatures needed to spend the peg UTXO. */
	signaturesRequired: number;
	/**
	 * Raw aggregate-key field: a 33-byte public key while DKG runs, or the v2
	 * marker `0xFF || block hash` once DKG is disabled. Not checked here.
	 */
	aggregatePubkey: Uint8Array;
	signerPrincipal: string;
}

/** Read the current signer set and threshold from `sbtc-registry`. */
export async function getSignerSet(client: Client): Promise<SbtcSignerSet> {
	const registry = getRegistryContract(client);
	const data = (await registry.read.getCurrentSignerData({})) as {
		currentAggregatePubkey: Uint8Array;
		currentSignatureThreshold: bigint;
		currentSignerPrincipal: string;
		currentSignerSet: Uint8Array[];
	};
	return {
		signerPublicKeys: data.currentSignerSet,
		signaturesRequired: Number(data.currentSignatureThreshold),
		aggregatePubkey: data.currentAggregatePubkey,
		signerPrincipal: data.currentSignerPrincipal,
	};
}

/**
 * Current signer-set aggregate public key (33-byte compressed), read from
 * `sbtc-registry`. Throws {@link SbtcV2MarkerError} once the registry holds
 * the v2 marker (`0xFF || block hash`) instead of a key.
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
	return assertRegistryAggregateKey(pubkey);
}

/** Options for {@link getSignersAddress}. */
export interface SbtcPegAddressOptions {
	/**
	 * Peg script format. Leave it out to pick the format the signers lock to
	 * at `burnBlockHeight`.
	 */
	version?: "v1" | "v2";
	/** Bitcoin height to resolve the format at. Defaults to the node's burn tip. */
	burnBlockHeight?: number;
	/**
	 * Height at which the signers switch to v2. Defaults to
	 * {@link SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET} on mainnet; required on other
	 * networks unless `version` is given.
	 */
	v2ActivationBurnHeight?: number;
}

/**
 * The sBTC peg address: where the signers lock the peg UTXO (sweeps pay it).
 * Users do not deposit here; deposits use their own P2TR deposit script.
 *
 * - v1 (before {@link SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET}): key-path
 *   `p2tr(aggregate pubkey)`.
 * - v2 (from that height): `tr(NUMS_V2, multi_a(threshold, signer/0/0, …))`
 *   derived from the registry signer set; the aggregate key is not used.
 *
 * With no options it returns the current format at the node's burn tip. From
 * the activation height until the first v2 sweep confirms, funds still sit at
 * the v1 address; follow the sweep chain to find the live UTXO.
 * Network-aware: `bc1p…` / `tb1p…` / `bcrt1p…` from the client's chain.
 */
export async function getSignersAddress(
	client: Client,
	options: SbtcPegAddressOptions = {},
): Promise<string> {
	const network = bitcoinNetworkFromChain(client);
	const version = options.version ?? (await pegVersionAt(client, options));
	if (version === "v1") {
		const pubkey = await getSignersPublicKey(client);
		return publicKeyToP2trAddress(pubkey, network);
	}
	const { signerPublicKeys, signaturesRequired } = await getSignerSet(client);
	return deriveSbtcV2PegOutput(signerPublicKeys, signaturesRequired, network)
		.address;
}

async function pegVersionAt(
	client: Client,
	options: SbtcPegAddressOptions,
): Promise<"v1" | "v2"> {
	const activation =
		options.v2ActivationBurnHeight ??
		(client.chain?.network === "mainnet"
			? SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET
			: undefined);
	if (activation == null) {
		throw new Error(
			`sBTC v2 signing has no fixed activation height on ${client.chain?.network ?? "this network"}; pass { version } or { v2ActivationBurnHeight }`,
		);
	}
	const height = options.burnBlockHeight ?? (await getBurnBlockHeight(client));
	return height >= activation ? "v2" : "v1";
}
