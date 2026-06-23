import type { Client } from "../../clients/types.ts";
import { getNonce } from "../public/getNonce.ts";
import type { NonceManagerSource } from "./nonceManager.ts";

/**
 * Mempool-aware {@link NonceManagerSource}s.
 *
 * The default {@link jsonRpcSource} reads only the confirmed nonce, so a tx
 * sitting in the mempool is invisible — broadcasting many quickly forces manual
 * tracking. These sources fold pending (mempool) txs into the next-nonce
 * computation. The gap-filling core is generic; where the pending set comes from
 * is pluggable, so you are never locked to any one provider:
 *
 *   - {@link mempoolAwareSource} — bring your own `getPending`.
 *   - {@link indexSource} — prebuilt over Secondlayer's `/v1/index/mempool`.
 *   - {@link hiroNonceSource} — prebuilt over Hiro's `/extended` nonces endpoint.
 */

type FetchImpl = typeof globalThis.fetch;

function resolveFetch(fetchImpl?: FetchImpl): FetchImpl {
	const f = fetchImpl ?? globalThis.fetch;
	if (!f)
		throw new Error("No fetch implementation available; pass `fetchImpl`");
	return f;
}

/**
 * The next free nonce ≥ `confirmed` not already taken by a pending tx.
 *
 * Unlike Hiro's `possible_next_nonce` (which is `max(pending) + 1` and strands
 * higher txs when a lower nonce is missing), this FILLS gaps: it returns the
 * lowest unused slot, so a dropped-tx hole is reused instead of stranding the
 * chain.
 */
export function nextFreeNonce(confirmed: bigint, pending: bigint[]): bigint {
	const taken = new Set(
		pending.filter((n) => n >= confirmed).map((n) => n.toString()),
	);
	let n = confirmed;
	while (taken.has(n.toString())) n += 1n;
	return n;
}

export type MempoolAwareSourceParams = {
	/** Pending (mempool) nonces for an address. */
	getPending: (args: {
		client: Client;
		address: string;
	}) => Promise<bigint[]>;
	/**
	 * Confirmed-nonce floor. Defaults to the node's `/v2/accounts` read — the
	 * user's own node via the client transport, no provider dependency.
	 */
	getConfirmed?: (args: { client: Client; address: string }) => Promise<bigint>;
};

/**
 * Build a gap-filling, mempool-aware source from any `getPending`. The confirmed
 * floor defaults to the node read; if `getPending` throws, the source degrades
 * to confirmed-only rather than blocking a broadcast.
 */
export function mempoolAwareSource(
	params: MempoolAwareSourceParams,
): NonceManagerSource {
	const getConfirmed =
		params.getConfirmed ??
		(({ client, address }) => getNonce(client, { address }));

	return {
		async get({ client, address }) {
			const confirmed = await getConfirmed({ client, address });
			let pending: bigint[] = [];
			try {
				pending = await params.getPending({ client, address });
			} catch {
				// Source unavailable — fall back to the confirmed floor. The local
				// increment in the manager still prevents same-process collisions.
				return confirmed;
			}
			return nextFreeNonce(confirmed, pending);
		},
	};
}

export type IndexSourceParams = {
	/** Secondlayer Index base URL. Default `https://api.secondlayer.tools`. */
	baseUrl?: string;
	/** Optional API key (keyless by default; supply to raise rate limits). */
	apiKey?: string;
	fetchImpl?: FetchImpl;
	/** Max mempool pages to page through per address. Default 10 (×200 = 2000 txs). */
	maxPages?: number;
	/** Override the confirmed floor (defaults to the node read). */
	getConfirmed?: (args: { client: Client; address: string }) => Promise<bigint>;
};

type IndexMempoolResponse = {
	mempool?: Array<{ nonce?: string | number | null }>;
	next_cursor?: string | null;
};

/**
 * Mempool-aware source backed by Secondlayer's `/v1/index/mempool` (our node's
 * observed mempool). `baseUrl` is configurable — point it at any shape-compatible
 * endpoint. Note our mempool is a go-forward, single-node observed view (not a
 * globally-aggregated mempool), so it can lag or miss txs our node never saw.
 */
export function indexSource(
	params: IndexSourceParams = {},
): NonceManagerSource {
	const baseUrl = (params.baseUrl ?? "https://api.secondlayer.tools").replace(
		/\/$/,
		"",
	);
	const fetchImpl = resolveFetch(params.fetchImpl);
	const maxPages = params.maxPages ?? 10;

	return mempoolAwareSource({
		getConfirmed: params.getConfirmed,
		async getPending({ address }) {
			const out: bigint[] = [];
			let cursor: string | undefined;
			let pages = 0;

			do {
				const url = new URL(`${baseUrl}/v1/index/mempool`);
				url.searchParams.set("sender", address);
				url.searchParams.set("limit", "200");
				if (cursor) url.searchParams.set("from_cursor", cursor);

				const res = await fetchImpl(url, {
					headers: params.apiKey
						? { authorization: `Bearer ${params.apiKey}` }
						: undefined,
				});
				if (!res.ok) {
					throw new Error(`indexSource: /v1/index/mempool ${res.status}`);
				}

				const data = (await res.json()) as IndexMempoolResponse;
				for (const tx of data.mempool ?? []) {
					if (tx.nonce != null) out.push(BigInt(tx.nonce));
				}
				cursor = data.next_cursor ?? undefined;
				pages += 1;
			} while (cursor && pages < maxPages);

			if (cursor) {
				console.warn(
					`indexSource: stopped paging mempool for ${address} after ${maxPages} pages; pending set may be incomplete`,
				);
			}
			return out;
		},
	});
}

export type HiroNonceSourceParams = {
	/** Hiro API base URL, e.g. `https://api.hiro.so` or `https://api.testnet.hiro.so`. */
	baseUrl: string;
	apiKey?: string;
	fetchImpl?: FetchImpl;
};

type HiroNoncesResponse = {
	last_executed_tx_nonce?: number | null;
	last_mempool_tx_nonce?: number | null;
	possible_next_nonce?: number | null;
	detected_missing_nonces?: number[];
};

/**
 * Off-the-shelf, non-Secondlayer mempool-aware source over Hiro's
 * `/extended/v1/address/{address}/nonces`. Fills the lowest detected gap first,
 * then falls back to `possible_next_nonce`. Requires a host that serves Hiro's
 * extended API (a bare stacks-node does not).
 */
export function hiroNonceSource(
	params: HiroNonceSourceParams,
): NonceManagerSource {
	const baseUrl = params.baseUrl.replace(/\/$/, "");
	const fetchImpl = resolveFetch(params.fetchImpl);

	return {
		async get({ address }) {
			const res = await fetchImpl(
				`${baseUrl}/extended/v1/address/${address}/nonces`,
				{
					headers: params.apiKey ? { "x-api-key": params.apiKey } : undefined,
				},
			);
			if (!res.ok) {
				throw new Error(`hiroNonceSource: /nonces ${res.status}`);
			}
			const data = (await res.json()) as HiroNoncesResponse;

			// Fill the lowest gap first — possible_next_nonce ignores gaps and would
			// strand the missing slots.
			const missing = (data.detected_missing_nonces ?? [])
				.map((n) => BigInt(n))
				.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
			if (missing[0] !== undefined) return missing[0];

			return BigInt(data.possible_next_nonce ?? 0);
		},
	};
}
