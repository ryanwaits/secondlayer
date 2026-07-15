/**
 * AI SDK-compatible read tools for the Stacks chain.
 *
 * Each tool is a `tool()` from `ai@^6` with a Zod input schema + async
 * execute that calls the underlying `@secondlayer/stacks` public action.
 * Works with `generateText`, `streamText`, or any other AI SDK caller.
 *
 * Two usage modes:
 *
 * 1. **Bare exports** — use the default public client (reads `STACKS_RPC_URL`
 *    + `STACKS_CHAIN` env vars). Zero-config:
 *
 *    ```ts
 *    import { generateText } from "ai"
 *    import { getStxBalance, bnsReverse } from "@secondlayer/stacks/tools"
 *    await generateText({
 *      model: anthropic("claude-sonnet-4-6"),
 *      tools: { getStxBalance, bnsReverse },
 *      prompt: "…",
 *    })
 *    ```
 *
 * 2. **Factory** — bind a custom client (testnet, custom RPC, etc.):
 *
 *    ```ts
 *    import { createPublicClient, http, testnet } from "@secondlayer/stacks"
 *    import { createStacksTools } from "@secondlayer/stacks/tools"
 *    const stacks = createStacksTools(
 *      createPublicClient({ chain: testnet, transport: http() }),
 *    )
 *    ```
 */

import { type Tool, tool } from "ai";
import { z } from "zod";

// biome-ignore lint/suspicious/noExplicitAny: Tool's input-schema generic too precise for isolated-declarations; AI SDK validates at runtime
type LooseTool = Tool<any, any>;
import { estimateFee as _estimateFee } from "../actions/public/estimateFee.ts";
import { getAccountHistory as _getAccountHistory } from "../actions/public/getAccountHistory.ts";
import { getAccountInfo as _getAccountInfo } from "../actions/public/getAccountInfo.ts";
import { getBalance as _getBalance } from "../actions/public/getBalance.ts";
import { getBlock as _getBlock } from "../actions/public/getBlock.ts";
import { getBlockHeight as _getBlockHeight } from "../actions/public/getBlockHeight.ts";
import { getMempoolStats as _getMempoolStats } from "../actions/public/getMempoolStats.ts";
import { getNftHoldings as _getNftHoldings } from "../actions/public/getNftHoldings.ts";
import { getTransaction as _getTransaction } from "../actions/public/getTransaction.ts";
import { readContract as _readContract } from "../actions/public/readContract.ts";
import {
	getPrimaryName as _getPrimaryName,
	resolveName as _resolveName,
} from "../bns/actions.ts";
import { type StacksReadClient, getDefaultPublicClient } from "./client.ts";

const PRINCIPAL = z
	.string()
	.describe("Stacks principal (SP…/SM… mainnet, ST… testnet)");

// --- Action wrappers bound to a client ---

async function stxBalance(client: StacksReadClient, principal: string) {
	const balance = await _getBalance(client, { address: principal });
	return { microStx: balance.toString() };
}

async function accountInfo(client: StacksReadClient, principal: string) {
	const info = await _getAccountInfo(client, { address: principal });
	return {
		balance: info.balance.toString(),
		nonce: info.nonce.toString(),
	};
}

async function block(
	client: StacksReadClient,
	args: { height?: number; hash?: string },
) {
	return _getBlock(client, args);
}

async function blockHeight(client: StacksReadClient) {
	return { height: await _getBlockHeight(client) };
}

async function contractRead(
	client: StacksReadClient,
	args: { contract: string; functionName: string; sender?: string },
) {
	const result = await _readContract(client, args);
	return { result: JSON.stringify(result) };
}

async function fee(client: StacksReadClient, serializedTxHex: string) {
	const raw = serializedTxHex.startsWith("0x")
		? serializedTxHex.slice(2)
		: serializedTxHex;
	const txBytes = new Uint8Array(Buffer.from(raw, "hex"));
	const { deserializeTransaction } = await import("@stacks/transactions");
	const transaction = deserializeTransaction(txBytes);
	const fees = await _estimateFee(client, {
		transaction: transaction as never,
	});
	return {
		low: fees[0]?.fee ?? 0,
		medium: fees[1]?.fee ?? 0,
		high: fees[2]?.fee ?? 0,
	};
}

async function bnsResolveImpl(client: StacksReadClient, name: string) {
	return { owner: await _resolveName(client, name) };
}

async function bnsReverseImpl(client: StacksReadClient, principal: string) {
	return { name: await _getPrimaryName(client, principal) };
}

// --- Extended-API-backed tools (beyond bare-node /v2) ---

async function transactionByTxId(client: StacksReadClient, txId: string) {
	return _getTransaction(client, { txid: txId });
}

async function accountHistory(
	client: StacksReadClient,
	principal: string,
	limit: number,
) {
	return _getAccountHistory(client, { address: principal, limit });
}

async function mempoolStats(client: StacksReadClient) {
	return _getMempoolStats(client);
}

async function nftHoldings(
	client: StacksReadClient,
	principal: string,
	limit: number,
) {
	return _getNftHoldings(client, { address: principal, limit });
}

// --- Factory: bind tools to an explicit client ---

export interface StacksTools {
	getStxBalance: LooseTool;
	getAccountInfo: LooseTool;
	getBlock: LooseTool;
	getBlockHeight: LooseTool;
	readContract: LooseTool;
	estimateFee: LooseTool;
	bnsResolve: LooseTool;
	bnsReverse: LooseTool;
	getTransaction: LooseTool;
	getAccountHistory: LooseTool;
	getMempoolStats: LooseTool;
	getNftHoldings: LooseTool;
}

export function createStacksTools(client: StacksReadClient): StacksTools {
	return {
		getStxBalance: tool({
			description: "Get the STX balance (in micro-STX) for a Stacks principal.",
			inputSchema: z.object({ principal: PRINCIPAL }),
			execute: ({ principal }) => stxBalance(client, principal),
		}),
		getAccountInfo: tool({
			description:
				"Get account info (balance, locked, nonce) for a Stacks principal.",
			inputSchema: z.object({ principal: PRINCIPAL }),
			execute: ({ principal }) => accountInfo(client, principal),
		}),
		getBlock: tool({
			description:
				"Fetch a Stacks block by height or hash. Omit both for the latest block.",
			inputSchema: z.object({
				height: z.number().int().nonnegative().optional(),
				hash: z.string().optional(),
			}),
			execute: (args) => block(client, args),
		}),
		getBlockHeight: tool({
			description: "Get the current Stacks chain tip height.",
			inputSchema: z.object({}),
			execute: () => blockHeight(client),
		}),
		readContract: tool({
			description:
				"Call a read-only Clarity function. Returns the decoded value as JSON.",
			inputSchema: z.object({
				contract: z
					.string()
					.describe("Fully-qualified contract id: '{address}.{name}'"),
				functionName: z.string(),
				sender: PRINCIPAL.optional(),
			}),
			execute: (args) => contractRead(client, args),
		}),
		estimateFee: tool({
			description:
				"Estimate fee range (low / medium / high) for a serialized Stacks transaction.",
			inputSchema: z.object({
				serializedTxHex: z
					.string()
					.describe("Hex-encoded serialized transaction"),
			}),
			execute: ({ serializedTxHex }) => fee(client, serializedTxHex),
		}),
		bnsResolve: tool({
			description:
				"Resolve a BNS name (e.g. 'satoshi.btc') to its owning Stacks principal.",
			inputSchema: z.object({
				name: z.string().describe("BNS name in 'name.namespace' form"),
			}),
			execute: ({ name }) => bnsResolveImpl(client, name),
		}),
		bnsReverse: tool({
			description:
				"Reverse-lookup the primary BNS name for a Stacks principal, if set.",
			inputSchema: z.object({ principal: PRINCIPAL }),
			execute: ({ principal }) => bnsReverseImpl(client, principal),
		}),
		getTransaction: tool({
			description:
				"Fetch a confirmed Stacks transaction by txId (Hiro extended API).",
			inputSchema: z.object({
				txId: z.string().describe("Transaction id, with or without 0x prefix"),
			}),
			execute: ({ txId }) => transactionByTxId(client, txId),
		}),
		getAccountHistory: tool({
			description:
				"Paginated transaction history for a Stacks principal (Hiro extended API).",
			inputSchema: z.object({
				principal: PRINCIPAL,
				limit: z.number().int().min(1).max(50).default(20),
			}),
			execute: ({ principal, limit }) =>
				accountHistory(client, principal, limit),
		}),
		getMempoolStats: tool({
			description:
				"Current mempool statistics: pending count, fee distribution, age buckets (Hiro extended API).",
			inputSchema: z.object({}),
			execute: () => mempoolStats(client),
		}),
		getNftHoldings: tool({
			description:
				"NFT holdings for a Stacks principal across all collections (Hiro extended API).",
			inputSchema: z.object({
				principal: PRINCIPAL,
				limit: z.number().int().min(1).max(50).default(20),
			}),
			execute: ({ principal, limit }) => nftHoldings(client, principal, limit),
		}),
	};
}

// --- Bare exports using the default (env-configured) client ---

export const getStxBalance: LooseTool = tool({
	description:
		"Get the STX balance (in micro-STX) for a Stacks principal. Uses default client.",
	inputSchema: z.object({ principal: PRINCIPAL }),
	execute: ({ principal }) => stxBalance(getDefaultPublicClient(), principal),
});

export const getAccountInfo: LooseTool = tool({
	description:
		"Get account info (balance, locked, nonce) for a Stacks principal.",
	inputSchema: z.object({ principal: PRINCIPAL }),
	execute: ({ principal }) => accountInfo(getDefaultPublicClient(), principal),
});

export const getBlock: LooseTool = tool({
	description:
		"Fetch a Stacks block by height or hash. Omit both for the latest block.",
	inputSchema: z.object({
		height: z.number().int().nonnegative().optional(),
		hash: z.string().optional(),
	}),
	execute: (args) => block(getDefaultPublicClient(), args),
});

export const getBlockHeight: LooseTool = tool({
	description: "Get the current Stacks chain tip height.",
	inputSchema: z.object({}),
	execute: () => blockHeight(getDefaultPublicClient()),
});

export const readContract: LooseTool = tool({
	description:
		"Call a read-only Clarity function. Returns the decoded value as JSON.",
	inputSchema: z.object({
		contract: z.string(),
		functionName: z.string(),
		sender: PRINCIPAL.optional(),
	}),
	execute: (args) => contractRead(getDefaultPublicClient(), args),
});

export const estimateFee: LooseTool = tool({
	description:
		"Estimate fee range (low / medium / high) for a serialized Stacks transaction.",
	inputSchema: z.object({ serializedTxHex: z.string() }),
	execute: ({ serializedTxHex }) =>
		fee(getDefaultPublicClient(), serializedTxHex),
});

export const bnsResolve: LooseTool = tool({
	description:
		"Resolve a BNS name (e.g. 'satoshi.btc') to its owning Stacks principal.",
	inputSchema: z.object({ name: z.string() }),
	execute: ({ name }) => bnsResolveImpl(getDefaultPublicClient(), name),
});

export const bnsReverse: LooseTool = tool({
	description:
		"Reverse-lookup the primary BNS name for a Stacks principal, if set.",
	inputSchema: z.object({ principal: PRINCIPAL }),
	execute: ({ principal }) =>
		bnsReverseImpl(getDefaultPublicClient(), principal),
});

export const getTransaction: LooseTool = tool({
	description:
		"Fetch a confirmed Stacks transaction by txId (Hiro extended API).",
	inputSchema: z.object({ txId: z.string() }),
	execute: ({ txId }) => transactionByTxId(getDefaultPublicClient(), txId),
});

export const getAccountHistory: LooseTool = tool({
	description:
		"Paginated transaction history for a Stacks principal (Hiro extended API).",
	inputSchema: z.object({
		principal: PRINCIPAL,
		limit: z.number().int().min(1).max(50).default(20),
	}),
	execute: ({ principal, limit }) =>
		accountHistory(getDefaultPublicClient(), principal, limit),
});

export const getMempoolStats: LooseTool = tool({
	description:
		"Current mempool statistics: pending count, fee distribution, age buckets (Hiro extended API).",
	inputSchema: z.object({}),
	execute: () => mempoolStats(getDefaultPublicClient()),
});

export const getNftHoldings: LooseTool = tool({
	description:
		"NFT holdings for a Stacks principal across all collections (Hiro extended API).",
	inputSchema: z.object({
		principal: PRINCIPAL,
		limit: z.number().int().min(1).max(50).default(20),
	}),
	execute: ({ principal, limit }) =>
		nftHoldings(getDefaultPublicClient(), principal, limit),
});
