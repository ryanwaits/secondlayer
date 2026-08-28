import type { Client } from "../../clients/types.ts";
import { getNonce } from "../public/getNonce.ts";
import {
	IndexSourceConfigError,
	indexNotFound,
	indexRequestFn,
} from "../public/txSources.ts";
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
 *   - {@link indexSource}: prebuilt over a Secondlayer instance's `/v1/index/mempool`.
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
 * to confirmed-only rather than blocking a broadcast. A misconfigured pending
 * feed ({@link IndexSourceConfigError}) is rethrown: it would fail on every
 * read, and degrading silently would hide that the mempool is never consulted.
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
			} catch (error) {
				if (error instanceof IndexSourceConfigError) throw error;
				// Source unavailable: fall back to the confirmed floor. The local
				// increment in the manager still prevents same-process collisions.
				return confirmed;
			}
			return nextFreeNonce(confirmed, pending);
		},
	};
}

export type IndexSourceParams = {
	/**
	 * URL of your Secondlayer instance. Without it the client's transport
	 * URL is assumed to be the instance: a transport on a Hiro host throws
	 * up front, and a host that answers `/v1/index` with a non-JSON 404
	 * (a bare stacks-node) throws on the first read. Neither is degraded
	 * to the confirmed floor. Pass it whenever the transport is not the
	 * instance.
	 */
	baseUrl?: string;
	/** Instance token, sent as `Authorization: Bearer`. */
	apiKey?: string;
	/** Max mempool pages to read per address. Default 10 (×200 = 2000 txs). */
	maxPages?: number;
	/** Override the confirmed floor (defaults to the node read). */
	getConfirmed?: (args: { client: Client; address: string }) => Promise<bigint>;
};

type IndexMempoolResponse = {
	mempool?: Array<{ nonce?: string | number | null }>;
	next_cursor?: string | null;
};

/**
 * Mempool-aware source backed by a Secondlayer instance's `/v1/index/mempool`.
 * Requests go through the transport layer (retries, timeout, typed errors).
 * The instance's mempool is a go-forward view observed by its own node, so
 * it can lag or miss transactions that node never saw; the manager's local
 * increment still prevents same-process collisions. Past `maxPages` the
 * pending set is truncated and the next free nonce may already be taken;
 * a nonce conflict at broadcast then resets the manager. Transient failures
 * (5xx, timeout) degrade to the confirmed floor; a missing or wrong instance
 * URL throws so the misconfiguration is visible on the first read.
 */
export function indexSource(
	params: IndexSourceParams = {},
): NonceManagerSource {
	const maxPages = params.maxPages ?? 10;
	const headers = params.apiKey
		? { authorization: `Bearer ${params.apiKey}` }
		: undefined;

	const source = mempoolAwareSource({
		getConfirmed: params.getConfirmed,
		async getPending({ client, address }) {
			const request = indexRequestFn(client, params.baseUrl, "indexSource");
			const out: bigint[] = [];
			let cursor: string | undefined;
			let pages = 0;

			do {
				const query = new URLSearchParams({
					sender: address,
					limit: "200",
				});
				if (cursor) query.set("from_cursor", cursor);

				let data: IndexMempoolResponse;
				try {
					data = (await request(`/v1/index/mempool?${query}`, {
						method: "GET",
						headers,
					})) as IndexMempoolResponse;
				} catch (error) {
					// A JSON 404 is an instance with nothing for this sender; a
					// non-JSON 404 is not an instance and throws a config error.
					if (indexNotFound(error, "indexSource")) break;
					throw error;
				}
				for (const tx of data.mempool ?? []) {
					if (tx.nonce != null) out.push(BigInt(tx.nonce));
				}
				cursor = data.next_cursor ?? undefined;
				pages += 1;
			} while (cursor && pages < maxPages);

			return out;
		},
	});

	return {
		async get(args) {
			// Resolve the instance before the degrade path so a missing or
			// Hiro-pointed transport URL rejects instead of returning the floor.
			indexRequestFn(args.client, params.baseUrl, "indexSource");
			return source.get(args);
		},
	};
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
