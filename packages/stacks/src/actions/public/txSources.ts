import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import type { Client } from "../../clients/types.ts";

/**
 * Pluggable transaction-status sources for {@link getTransaction} /
 * `waitForTransactionReceipt`.
 *
 * A bare stacks-node has no confirmed-transaction endpoint, so status reads
 * need a host that indexes transactions. Where that data comes from is
 * pluggable, mirroring the nonce sources:
 *
 *   - {@link extendedApiSource} — default; `/extended/v1/tx/{txid}` on the
 *     client's transport host (Hiro API or any extended-API-compatible host).
 *   - {@link indexTxSource} — Secondlayer's `/v1/index/transactions/{txid}`;
 *     returns the chain tip in the same response, so N-confirmation waits
 *     need no second request.
 */

export type TransactionStatus =
	| "pending"
	| "success"
	| "abort_by_response"
	| "abort_by_post_condition"
	| "dropped";

export type TransactionReceipt = {
	txid: string;
	status: TransactionStatus;
	/** Anchor block height; absent while pending. */
	blockHeight?: number;
	blockHash?: string;
	/** Decoded Clarity result; absent while pending or when the source omits it. */
	result?: ClarityValue;
	resultHex?: string;
	events: unknown[];
	/** The source's unnormalized response, for fields the receipt doesn't model. */
	raw: unknown;
};

export type TransactionSnapshot = {
	/** `null` when the source has no record of the tx (mempool + chain). */
	receipt: TransactionReceipt | null;
	/** Chain tip height, when the source knows it (saves a round-trip). */
	tip?: number;
};

export type TransactionStatusSource = {
	get(args: { client: Client; txid: string }): Promise<TransactionSnapshot>;
};

type FetchImpl = typeof globalThis.fetch;

function resolveFetch(fetchImpl?: FetchImpl): FetchImpl {
	const f = fetchImpl ?? globalThis.fetch;
	if (!f)
		throw new Error("No fetch implementation available; pass `fetchImpl`");
	return f;
}

function normalizeTxid(txid: string): string {
	return txid.startsWith("0x") ? txid : `0x${txid}`;
}

function decodeResultHex(hex: string | null | undefined): {
	result?: ClarityValue;
	resultHex?: string;
} {
	if (!hex) return {};
	try {
		return { result: deserializeCVBytes(hex), resultHex: hex };
	} catch {
		return { resultHex: hex };
	}
}

/** Map a Hiro `tx_status` string onto the receipt vocabulary. */
function normalizeStatus(txStatus: string): TransactionStatus | undefined {
	switch (txStatus) {
		case "pending":
		case "success":
		case "abort_by_response":
		case "abort_by_post_condition":
			return txStatus;
		default:
			return txStatus.startsWith("dropped") ? "dropped" : undefined;
	}
}

/**
 * Default source: `GET /extended/v1/tx/{txid}` via the client's transport.
 * Requires a host that serves Hiro's extended API (a bare stacks-node does
 * not). Does not report the chain tip — the wait action fetches it separately
 * when `confirmations > 1`.
 */
export function extendedApiSource(): TransactionStatusSource {
	return {
		async get({ client, txid }) {
			const data = await client.request(
				`/extended/v1/tx/${normalizeTxid(txid)}`,
				{ method: "GET" },
			);

			const txStatus =
				typeof data?.tx_status === "string" ? data.tx_status : undefined;
			if (!txStatus) return { receipt: null }; // 404 body or unexpected shape

			const status = normalizeStatus(txStatus);
			if (!status) return { receipt: null };

			return {
				receipt: {
					txid: normalizeTxid(txid),
					status,
					blockHeight:
						typeof data.block_height === "number" && data.block_height > 0
							? data.block_height
							: undefined,
					blockHash: data.block_hash ?? undefined,
					...decodeResultHex(data.tx_result?.hex),
					events: Array.isArray(data.events) ? data.events : [],
					raw: data,
				},
			};
		},
	};
}

export type IndexTxSourceParams = {
	/** Base URL of a Secondlayer-shaped index API. */
	baseUrl?: string;
	apiKey?: string;
	fetchImpl?: FetchImpl;
};

/**
 * Source backed by Secondlayer's `/v1/index/transactions/{txid}`. The response
 * embeds the chain tip, so N-confirmation math needs no extra request. The
 * index only returns canonical (mined) transactions — while a tx is in the
 * mempool this source reports `receipt: null`, and the wait action's grace
 * window carries it until inclusion.
 */
export function indexTxSource(
	params: IndexTxSourceParams = {},
): TransactionStatusSource {
	const baseUrl = (params.baseUrl ?? "https://api.secondlayer.tools").replace(
		/\/$/,
		"",
	);
	const fetchImpl = resolveFetch(params.fetchImpl);

	return {
		async get({ txid }) {
			const res = await fetchImpl(
				`${baseUrl}/v1/index/transactions/${normalizeTxid(txid)}`,
				{
					headers: params.apiKey ? { "x-api-key": params.apiKey } : undefined,
				},
			);
			if (res.status === 404) {
				return { receipt: null };
			}
			if (!res.ok) {
				throw new Error(`indexTxSource: /v1/index/transactions ${res.status}`);
			}

			const data = (await res.json()) as {
				transaction?: {
					tx_id: string;
					block_height: number;
					status: string;
					contract_call?: { result_hex: string | null };
				};
				tip?: { block_height: number };
			};
			const tx = data.transaction;
			const tip = data.tip?.block_height;
			if (!tx) return { receipt: null, tip };

			const status = normalizeStatus(tx.status) ?? "success";
			return {
				receipt: {
					txid: normalizeTxid(tx.tx_id),
					status,
					blockHeight: tx.block_height,
					...decodeResultHex(tx.contract_call?.result_hex),
					events: [],
					raw: data,
				},
				tip,
			};
		},
	};
}
