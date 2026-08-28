import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import type { Client } from "../../clients/types.ts";
import { HttpRequestError } from "../../errors/http.ts";
import { buildRequestFn } from "../../transports/createTransport.ts";
import type { RequestFn } from "../../transports/types.ts";

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
 *   - {@link indexTxSource}: a Secondlayer instance's
 *     `/v1/index/transactions/{txid}`; returns the chain tip in the same
 *     response, so N-confirmation waits need no second request.
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
	/**
	 * True when the source only knows mined transactions and reports
	 * `receipt: null` for the whole mempool life of a tx. The wait action
	 * then stretches its dropped-grace window to the full timeout, since
	 * "unknown" cannot mean "dropped" until the deadline.
	 */
	canonicalOnly?: boolean;
};

/**
 * Thrown when an index-backed source cannot reach a Secondlayer instance
 * because of how it was configured (no URL, a Hiro host, a bare node).
 * Sources that degrade on transient failures let this one through: a
 * misconfiguration would otherwise degrade silently on every read.
 */
export class IndexSourceConfigError extends Error {
	override name = "IndexSourceConfigError";
}

/** Hosts that serve Hiro's API, never a Secondlayer instance. */
function isHiroHost(url: string, client: Client): boolean {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return false;
	}
	if (hostname === "hiro.so" || hostname.endsWith(".hiro.so")) return true;
	const defaults = client.chain?.rpcUrls?.default?.http ?? [];
	return defaults.some((d) => {
		try {
			return new URL(d).hostname === hostname && hostname !== "localhost";
		} catch {
			return false;
		}
	});
}

/**
 * Pick the request function for a Secondlayer index route. With no
 * `baseUrl` the client's transport URL is taken to be the instance and
 * `client.request` carries its retries, timeout and auth; a transport
 * pointed at a Hiro host throws instead of polling routes it cannot serve.
 * A different `baseUrl` gets the transport's retry and timeout policy
 * bound to that host. Only policy crosses over: the transport's `apiKey`
 * and `fetchOptions` were issued for the transport host and never travel
 * to another one.
 */
export function indexRequestFn(
	client: Client,
	baseUrl: string | undefined,
	sourceName: string,
): RequestFn {
	const transportUrl = client.transport.config.url?.replace(/\/$/, "");
	if (baseUrl === undefined) {
		if (!transportUrl) {
			throw new IndexSourceConfigError(
				`${sourceName} needs the URL of your Secondlayer instance: pass baseUrl, or use an http() transport pointed at the instance`,
			);
		}
		if (isHiroHost(transportUrl, client)) {
			throw new IndexSourceConfigError(
				`${sourceName} reads /v1/index on a Secondlayer instance, and ${transportUrl} is a Hiro host: pass baseUrl with the URL of your instance`,
			);
		}
		return client.request;
	}
	const target = baseUrl.replace(/\/$/, "");
	if (target === transportUrl) return client.request;
	const { timeout, retryCount, retryDelay } = client.transport.config;
	return buildRequestFn(target, { timeout, retryCount, retryDelay });
}

/**
 * An instance answers an unknown tx with a JSON 404.
 * A 404 with a non-JSON body comes from a host that does not serve
 * `/v1/index` at all (a bare stacks-node, an unmatched route), so it is a
 * configuration error rather than "not mined yet".
 */
export function indexNotFound(
	error: unknown,
	sourceName: string,
): error is HttpRequestError {
	if (!(error instanceof HttpRequestError) || error.status !== 404) {
		return false;
	}
	const body = error.details;
	if (body !== undefined) {
		try {
			JSON.parse(body);
		} catch {
			throw new IndexSourceConfigError(
				`${sourceName} got a non-JSON 404 from ${error.url ?? "the transport host"}: it does not serve /v1/index, pass baseUrl with the URL of your Secondlayer instance`,
				{ cause: error },
			);
		}
	}
	return true;
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
			let data: Awaited<ReturnType<Client["request"]>>;
			try {
				data = await client.request(`/extended/v1/tx/${normalizeTxid(txid)}`, {
					method: "GET",
				});
			} catch (error) {
				if (error instanceof HttpRequestError && error.status === 404) {
					return { receipt: null };
				}
				throw error;
			}

			const txStatus =
				typeof data?.tx_status === "string" ? data.tx_status : undefined;
			if (!txStatus) return { receipt: null }; // unexpected shape

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
	/**
	 * URL of your Secondlayer instance. Without it the client's transport
	 * URL is assumed to be the instance: a transport on a Hiro host throws
	 * up front, and a host that answers `/v1/index` with a non-JSON 404
	 * (a bare stacks-node) throws on the first read. Pass it whenever the
	 * transport is not the instance.
	 */
	baseUrl?: string;
	/** Instance token, sent as `Authorization: Bearer`. */
	apiKey?: string;
};

/**
 * Source backed by a Secondlayer instance's `/v1/index/transactions/{txid}`.
 * The response embeds the chain tip, so N-confirmation math needs no extra
 * request. Requests go through the transport layer: same retries, timeout
 * and typed errors as every other read. The index only returns canonical
 * (mined) transactions; while a tx is in the mempool this source reports
 * `receipt: null`, and the wait action's grace window carries it until
 * inclusion.
 */
export function indexTxSource(
	params: IndexTxSourceParams = {},
): TransactionStatusSource {
	const headers = params.apiKey
		? { authorization: `Bearer ${params.apiKey}` }
		: undefined;

	return {
		canonicalOnly: true,
		async get({ client, txid }) {
			const request = indexRequestFn(client, params.baseUrl, "indexTxSource");
			let data: {
				transaction?: {
					tx_id: string;
					block_height: number;
					status: string;
					contract_call?: { result_hex: string | null };
				};
				tip?: { block_height: number };
			};
			try {
				data = await request(`/v1/index/transactions/${normalizeTxid(txid)}`, {
					method: "GET",
					headers,
				});
			} catch (error) {
				if (indexNotFound(error, "indexTxSource")) return { receipt: null };
				throw error;
			}
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
