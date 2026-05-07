import { getContract } from "../actions/getContract.ts";
import type { Client } from "../clients/types.ts";
import { SBTC_TOKEN_ABI } from "./abi.ts";
import { SBTC_CONTRACTS } from "./constants.ts";

function getTokenContract(client: Client) {
	if (!client.chain) {
		throw new Error("Client must have a chain configured");
	}
	const network = client.chain.network;
	const contract =
		network === "mainnet" ? SBTC_CONTRACTS.mainnet : SBTC_CONTRACTS.testnet;
	return getContract({
		client,
		address: contract.address,
		name: contract.token,
		abi: SBTC_TOKEN_ABI,
	});
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
