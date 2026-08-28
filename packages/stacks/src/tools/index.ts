/**
 * AI SDK read tools for the Stacks chain.
 *
 * @deprecated Point your agent at `@secondlayer/mcp` instead: it serves the
 * same reads over MCP against your instance, and it is the wrapper that keeps
 * getting maintained. This entry stays importable until the next major so
 * existing `generateText` callers keep working, but it gets no new tools.
 * Installing it means installing `ai` and `zod` yourself: both are optional
 * peers of the package, not dependencies.
 *
 * Each tool is a `tool()` from `ai@^6` with a Zod input schema + async
 * execute that calls the underlying `@secondlayer/stacks` public action.
 * Works with `generateText`, `streamText`, or any other AI SDK caller.
 *
 * Two usage modes:
 *
 * 1. Bare exports: use the default public client, configured from the
 *    environment (`STACKS_NETWORK`, `STACKS_NODE_RPC_URL` or `SL_API_URL`;
 *    the older `STACKS_CHAIN` and `STACKS_RPC_URL` still work). Zero-config:
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
 * 2. Factory: bind a custom client (testnet, custom RPC, etc.):
 *
 *    ```ts
 *    import { createPublicClient, http, testnet } from "@secondlayer/stacks"
 *    import { createStacksTools } from "@secondlayer/stacks/tools"
 *    const stacks = createStacksTools(
 *      createPublicClient({ chain: testnet, transport: http() }),
 *    )
 *    ```
 *
 * Every input that becomes part of a request path is validated before any
 * fetch happens, so a model-supplied value cannot steer the request to
 * another route on the RPC host. Every output is plain JSON: Clarity values
 * go through `cvToJSON`, so `uint`/`int` arrive as decimal strings instead of
 * crashing the tool call on a `bigint`.
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
import { minimumFee } from "../actions/wallet/utils.ts";
import {
	getPrimaryName as _getPrimaryName,
	resolveName as _resolveName,
} from "../bns/actions.ts";
import { cvToJSON } from "../clarity/prettyPrint.ts";
import type { StacksTransaction } from "../transactions/types.ts";
import { deserializeTransaction } from "../transactions/wire/deserialize.ts";
import { isClarityName, parsePrincipal } from "../utils/address.ts";
import { hexToBytes } from "../utils/encoding.ts";
import { type StacksReadClient, getDefaultPublicClient } from "./client.ts";

// --- Input schemas: reject anything that is not a well-formed value before a request is built ---

const PRINCIPAL = z
	.string()
	.refine((v) => parsePrincipal(v) !== null, {
		message:
			"Expected a Stacks principal: a c32 address (SP…/SM… mainnet, ST… testnet), optionally followed by .contract-name",
	})
	.describe("Stacks principal (SP…/SM… mainnet, ST… testnet)");

const CONTRACT_ID = z
	.string()
	.refine((v) => parsePrincipal(v)?.contractName !== undefined, {
		message: "Expected a contract id in '{address}.{name}' form",
	})
	.describe("Fully-qualified contract id: '{address}.{name}'");

const FUNCTION_NAME = z
	.string()
	.refine(isClarityName, { message: "Expected a Clarity function name" });

const HASH_32 = /^(0x)?[0-9a-fA-F]{64}$/;
const TX_ID = z
	.string()
	.regex(HASH_32, "Expected a 32-byte hex transaction id")
	.describe("Transaction id, with or without 0x prefix");
const BLOCK_HASH = z
	.string()
	.regex(HASH_32, "Expected a 32-byte hex block hash");

// --- Action wrappers bound to a client resolver ---

type Resolve = () => StacksReadClient;

async function stxBalance(resolve: Resolve, principal: string) {
	const balance = await _getBalance(resolve(), { address: principal });
	return { microStx: balance.toString() };
}

async function accountInfo(resolve: Resolve, principal: string) {
	const info = await _getAccountInfo(resolve(), { address: principal });
	return {
		balance: info.balance.toString(),
		nonce: info.nonce.toString(),
	};
}

async function block(
	resolve: Resolve,
	args: { height?: number; hash?: string },
) {
	return _getBlock(resolve(), args);
}

async function blockHeight(resolve: Resolve) {
	return { height: await _getBlockHeight(resolve()) };
}

async function contractRead(
	resolve: Resolve,
	args: { contract: string; functionName: string; sender?: string },
) {
	const result = await _readContract(resolve(), args);
	return { result: cvToJSON(result) };
}

function assertValidHex(raw: string): void {
	if (raw.length % 2 !== 0) {
		throw new Error("serializedTxHex: odd-length hex string");
	}
	if (!/^[0-9a-fA-F]+$/.test(raw)) {
		throw new Error("serializedTxHex: contains non-hex characters");
	}
}

/**
 * Fee tiers for a serialized transaction. When the node has no estimate
 * (a cold mempool, an unsupported payload) every tier is the relay
 * minimum and `source` says so, instead of reporting zero. `tiers` is
 * how many estimates the node returned, so a caller can tell a padded
 * medium/high from a live one.
 */
async function fee(resolve: Resolve, serializedTxHex: string) {
	const raw = serializedTxHex.startsWith("0x")
		? serializedTxHex.slice(2)
		: serializedTxHex;
	assertValidHex(raw);
	const txBytes = hexToBytes(raw);
	let transaction: StacksTransaction;
	try {
		transaction = deserializeTransaction(txBytes);
	} catch (e) {
		throw new Error(
			`serializedTxHex: deserialization failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	const fees = await _estimateFee(resolve(), { transaction });
	if (fees.length === 0) {
		const min = Number(minimumFee(transaction));
		return {
			low: min,
			medium: min,
			high: min,
			source: "min" as const,
			tiers: 0,
		};
	}
	const low = fees[0]?.fee ?? 0;
	return {
		low,
		medium: fees[1]?.fee ?? low,
		high: fees[2]?.fee ?? fees[1]?.fee ?? low,
		source: "node" as const,
		tiers: fees.length,
	};
}

async function bnsResolveImpl(resolve: Resolve, name: string) {
	return { owner: await _resolveName(resolve(), name) };
}

async function bnsReverseImpl(resolve: Resolve, principal: string) {
	return { name: await _getPrimaryName(resolve(), principal) };
}

// --- Tools that need a host serving the extended API (a bare stacks-node has none) ---

async function transactionByTxId(resolve: Resolve, txId: string) {
	const receipt = await _getTransaction(resolve(), { txid: txId });
	if (!receipt) return null;
	const { result, ...rest } = receipt;
	return result === undefined ? rest : { ...rest, result: cvToJSON(result) };
}

async function accountHistory(
	resolve: Resolve,
	principal: string,
	limit: number,
) {
	return _getAccountHistory(resolve(), { address: principal, limit });
}

async function mempoolStats(resolve: Resolve) {
	return _getMempoolStats(resolve());
}

async function nftHoldings(resolve: Resolve, principal: string, limit: number) {
	return _getNftHoldings(resolve(), { address: principal, limit });
}

// --- Tool set ---

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

const EXTENDED = "Needs a host that serves the extended API.";

function buildTools(resolve: Resolve): StacksTools {
	return {
		getStxBalance: tool({
			description: "Get the STX balance (in micro-STX) for a Stacks principal.",
			inputSchema: z.object({ principal: PRINCIPAL }),
			execute: ({ principal }) => stxBalance(resolve, principal),
		}),
		getAccountInfo: tool({
			description:
				"Get the STX balance (micro-STX) and next nonce for a Stacks principal.",
			inputSchema: z.object({ principal: PRINCIPAL }),
			execute: ({ principal }) => accountInfo(resolve, principal),
		}),
		getBlock: tool({
			description:
				"Fetch one Stacks block by height or hash. Omit both for the latest block. Always returns a single block object.",
			inputSchema: z.object({
				height: z.number().int().nonnegative().optional(),
				hash: BLOCK_HASH.optional(),
			}),
			execute: (args) => block(resolve, args),
		}),
		getBlockHeight: tool({
			description: "Get the current Stacks chain tip height.",
			inputSchema: z.object({}),
			execute: () => blockHeight(resolve),
		}),
		readContract: tool({
			description:
				"Call a read-only Clarity function that takes no arguments. Returns the decoded value as JSON; uint and int arrive as decimal strings.",
			inputSchema: z.object({
				contract: CONTRACT_ID,
				functionName: FUNCTION_NAME,
				sender: PRINCIPAL.optional(),
			}),
			execute: (args) => contractRead(resolve, args),
		}),
		estimateFee: tool({
			description:
				"Estimate fee tiers (low / medium / high, in micro-STX) for a serialized Stacks transaction. `source` is 'node' for a live estimate or 'min' when the node had none and the relay minimum was used. `tiers` is how many estimates the node returned; when it is below 3 the missing tiers repeat the nearest lower one.",
			inputSchema: z.object({
				serializedTxHex: z
					.string()
					.describe("Hex-encoded serialized transaction"),
			}),
			execute: ({ serializedTxHex }) => fee(resolve, serializedTxHex),
		}),
		bnsResolve: tool({
			description:
				"Resolve a BNS name (e.g. 'satoshi.btc') to its owning Stacks principal.",
			inputSchema: z.object({
				name: z.string().describe("BNS name in 'name.namespace' form"),
			}),
			execute: ({ name }) => bnsResolveImpl(resolve, name),
		}),
		bnsReverse: tool({
			description:
				"Reverse-lookup the primary BNS name for a Stacks principal, if set.",
			inputSchema: z.object({ principal: PRINCIPAL }),
			execute: ({ principal }) => bnsReverseImpl(resolve, principal),
		}),
		getTransaction: tool({
			description: `Fetch a confirmed Stacks transaction by txId, with its decoded result as JSON. ${EXTENDED}`,
			inputSchema: z.object({ txId: TX_ID }),
			execute: ({ txId }) => transactionByTxId(resolve, txId),
		}),
		getAccountHistory: tool({
			description: `List the most recent transactions for a Stacks principal (first page only, up to 50). ${EXTENDED}`,
			inputSchema: z.object({
				principal: PRINCIPAL,
				limit: z.number().int().min(1).max(50).default(20),
			}),
			execute: ({ principal, limit }) =>
				accountHistory(resolve, principal, limit),
		}),
		getMempoolStats: tool({
			description: `Current mempool statistics: pending count, fee distribution, age buckets. ${EXTENDED}`,
			inputSchema: z.object({}),
			execute: () => mempoolStats(resolve),
		}),
		getNftHoldings: tool({
			description: `List NFTs held by a Stacks principal across all collections (first page only, up to 50). ${EXTENDED}`,
			inputSchema: z.object({
				principal: PRINCIPAL,
				limit: z.number().int().min(1).max(50).default(20),
			}),
			execute: ({ principal, limit }) => nftHoldings(resolve, principal, limit),
		}),
	};
}

/**
 * Bind the tool set to an explicit client.
 *
 * @deprecated Use `@secondlayer/mcp` for agent access to Stacks reads.
 */
export function createStacksTools(client: StacksReadClient): StacksTools {
	return buildTools(() => client);
}

// --- Bare exports: the same tool set, bound to the env-configured default client ---
// The client is resolved on first call, not at import, so env is read lazily.

const defaultTools: StacksTools = buildTools(getDefaultPublicClient);

/** @deprecated Use `@secondlayer/mcp`. */
export const getStxBalance: LooseTool = defaultTools.getStxBalance;
/** @deprecated Use `@secondlayer/mcp`. */
export const getAccountInfo: LooseTool = defaultTools.getAccountInfo;
/** @deprecated Use `@secondlayer/mcp`. */
export const getBlock: LooseTool = defaultTools.getBlock;
/** @deprecated Use `@secondlayer/mcp`. */
export const getBlockHeight: LooseTool = defaultTools.getBlockHeight;
/** @deprecated Use `@secondlayer/mcp`. */
export const readContract: LooseTool = defaultTools.readContract;
/** @deprecated Use `@secondlayer/mcp`. */
export const estimateFee: LooseTool = defaultTools.estimateFee;
/** @deprecated Use `@secondlayer/mcp`. */
export const bnsResolve: LooseTool = defaultTools.bnsResolve;
/** @deprecated Use `@secondlayer/mcp`. */
export const bnsReverse: LooseTool = defaultTools.bnsReverse;
/** @deprecated Use `@secondlayer/mcp`. */
export const getTransaction: LooseTool = defaultTools.getTransaction;
/** @deprecated Use `@secondlayer/mcp`. */
export const getAccountHistory: LooseTool = defaultTools.getAccountHistory;
/** @deprecated Use `@secondlayer/mcp`. */
export const getMempoolStats: LooseTool = defaultTools.getMempoolStats;
/** @deprecated Use `@secondlayer/mcp`. */
export const getNftHoldings: LooseTool = defaultTools.getNftHoldings;
