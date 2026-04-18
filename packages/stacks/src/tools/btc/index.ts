/**
 * Bitcoin read tools, callable from a Stacks workflow. Useful for sBTC
 * peg-in/peg-out flows, BTC-collateralized lending, and anywhere a Stacks
 * contract's behaviour depends on BTC state.
 *
 * Backed by mempool.space by default. Override per-tool call is not
 * supported today; swap endpoints by setting `BTC_MEMPOOL_URL` in the
 * workflow runtime env. Reads only — no BTC writes.
 *
 *   import { btcConfirmations, btcBalance } from "@secondlayer/stacks/tools/btc"
 *   await step.generateText("research", { tools: { btcConfirmations, btcBalance }, … })
 */

import { type Tool, tool } from "ai";
import { z } from "zod";

// biome-ignore lint/suspicious/noExplicitAny: Tool's input-schema generic is too
// precise for isolated-declarations output — we pass tools through to AI SDK
// which validates at runtime.
type LooseTool = Tool<any, any>;

function baseUrl(): string {
	return (process.env.BTC_MEMPOOL_URL ?? "https://mempool.space").replace(
		/\/$/,
		"",
	);
}

async function get<T>(path: string): Promise<T> {
	const res = await fetch(`${baseUrl()}${path}`, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(
			`BTC mempool.space ${path} → ${res.status} ${res.statusText}`,
		);
	}
	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) return res.json() as Promise<T>;
	return res.text() as unknown as Promise<T>;
}

const BTC_TXID = z
	.string()
	.regex(/^[0-9a-fA-F]{64}$/, "64-character hex BTC txid");
const BTC_ADDRESS = z
	.string()
	.describe("Bitcoin address (legacy, segwit, or taproot)");

export const btcConfirmations: LooseTool = tool({
	description:
		"Number of confirmations for a Bitcoin transaction. Returns { confirmations, confirmed }.",
	inputSchema: z.object({ txid: BTC_TXID }),
	execute: async ({ txid }) => {
		const tx = await get<{
			status: { confirmed: boolean; block_height?: number };
		}>(`/api/tx/${txid}`);
		if (!tx.status.confirmed || tx.status.block_height == null) {
			return { confirmed: false, confirmations: 0 };
		}
		const tip = await get<number>("/api/blocks/tip/height");
		return {
			confirmed: true,
			confirmations: Math.max(0, tip - tx.status.block_height + 1),
			blockHeight: tx.status.block_height,
		};
	},
});

export const btcBalance: LooseTool = tool({
	description:
		"Bitcoin balance for an address, in satoshis. Returns { confirmedSat, unconfirmedSat }.",
	inputSchema: z.object({ address: BTC_ADDRESS }),
	execute: async ({ address }) => {
		const info = await get<{
			chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
			mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
		}>(`/api/address/${address}`);
		return {
			confirmedSat:
				info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum,
			unconfirmedSat:
				info.mempool_stats.funded_txo_sum - info.mempool_stats.spent_txo_sum,
		};
	},
});

export const btcUtxos: LooseTool = tool({
	description:
		"List of unspent outputs for a Bitcoin address (truncated to `limit`).",
	inputSchema: z.object({
		address: BTC_ADDRESS,
		limit: z.number().int().min(1).max(50).default(25),
	}),
	execute: async ({ address, limit }) => {
		const utxos = await get<
			Array<{
				txid: string;
				vout: number;
				value: number;
				status: { confirmed: boolean; block_height?: number };
			}>
		>(`/api/address/${address}/utxo`);
		return { utxos: utxos.slice(0, limit) };
	},
});

export const btcFeeEstimate: LooseTool = tool({
	description:
		"Current Bitcoin fee estimates in sat/vB across priority tiers (fastest, 30-min, hour, economy).",
	inputSchema: z.object({}),
	execute: async () => {
		const fees = await get<Record<string, number>>("/api/v1/fees/recommended");
		return {
			fastestSatVb: fees.fastestFee ?? 0,
			halfHourSatVb: fees.halfHourFee ?? 0,
			hourSatVb: fees.hourFee ?? 0,
			economySatVb: fees.economyFee ?? 0,
			minimumSatVb: fees.minimumFee ?? 0,
		};
	},
});

export const btcBlockHeight: LooseTool = tool({
	description: "Current Bitcoin chain tip height.",
	inputSchema: z.object({}),
	execute: async () => ({
		height: await get<number>("/api/blocks/tip/height"),
	}),
});
