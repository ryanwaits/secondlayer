import { defaultInternalIndexApiKey } from "./index-internal-auth.ts";

/**
 * Low-level transport for the public Index (`/v1/index`) + Streams clock
 * (`/v1/streams`) HTTP APIs: cursor-paginated reads, tip, reorgs. Lives in
 * `shared` (a leaf both the SDK and the subgraph runtime depend on) so the wire
 * format has one home and no package cycle. The SDK's ergonomic client should
 * eventually consume these row types too (see the plan's convergence task).
 *
 * This is intentionally minimal — just the GETs the subgraph runtime's
 * PublicApiBlockSource needs. It is NOT the SDK's full client (walk/consume/
 * retries/auth resolution).
 */

const PAGE_LIMIT = 1000;

type Envelope<K extends string, T> = {
	[P in K]: T[];
} & { next_cursor: string | null };

// ── Index API wire shapes (single source of truth) ─────────────────────────
export type IndexBlockRow = {
	block_height: number;
	block_hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	block_time: string | null;
};

type IndexEventCommon = {
	block_height: number;
	tx_id: string;
	event_index: number;
	contract_id: string | null;
};

export type IndexEventRow = IndexEventCommon &
	(
		| {
				event_type: "ft_transfer" | "ft_mint" | "ft_burn";
				asset_identifier: string;
				sender?: string;
				recipient?: string;
				amount: string;
		  }
		| {
				event_type: "nft_transfer" | "nft_mint" | "nft_burn";
				asset_identifier: string;
				sender?: string;
				recipient?: string;
				value: string;
		  }
		| {
				event_type: "stx_transfer" | "stx_mint" | "stx_burn";
				sender?: string;
				recipient?: string;
				amount: string;
				memo?: string | null;
		  }
		| {
				event_type: "stx_lock";
				sender: string;
				amount: string;
				payload: { unlock_height: string | null };
		  }
		| {
				event_type: "print";
				payload: {
					topic: string | null;
					value: unknown;
					raw_value: string | null;
				};
		  }
	);

export type IndexTransactionRow = {
	tx_id: string;
	block_height: number;
	tx_index: number;
	tx_type: string;
	sender: string;
	status: string;
	contract_call?: {
		contract_id: string;
		function_name: string;
		function_args_hex?: string[] | null;
		result_hex?: string | null;
	} | null;
	smart_contract?: { contract_id: string | null } | null;
};

export type StreamsReorgRow = {
	detected_at: string;
	fork_point_height: number;
	orphaned_range: { from: string; to: string };
	new_canonical_tip: string;
};

export type IndexHttpOptions = {
	/** Base URL for /v1/index (the decoded data plane). */
	indexBaseUrl: string;
	/** Bearer for /v1/index. Defaults to the internal enterprise key. */
	indexApiKey?: string;
	/** Base URL for /v1/streams (the canonical clock). */
	streamsBaseUrl: string;
	/** Bearer for /v1/streams (internal enterprise key). */
	streamsApiKey: string;
};

export class IndexHttpClient {
	private readonly indexBaseUrl: string;
	private readonly indexApiKey: string;
	private readonly streamsBaseUrl: string;
	private readonly streamsApiKey: string;

	constructor(opts: IndexHttpOptions) {
		this.indexBaseUrl = opts.indexBaseUrl.replace(/\/+$/, "");
		this.indexApiKey = opts.indexApiKey ?? defaultInternalIndexApiKey();
		this.streamsBaseUrl = opts.streamsBaseUrl.replace(/\/+$/, "");
		this.streamsApiKey = opts.streamsApiKey;
	}

	private async get<T>(url: string, apiKey: string): Promise<T> {
		// Index reads are anon — omit the header entirely when no key is set, so
		// an empty key reads anonymously rather than 401-ing as an invalid bearer.
		const res = await fetch(url, {
			headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
		});
		if (!res.ok) {
			throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as T;
	}

	/** Fetch a single cursor page of an Index collection. */
	private async getPage<K extends string, T>(
		path: string,
		key: K,
		params: URLSearchParams,
	): Promise<{ items: T[]; next_cursor: string | null }> {
		const env: Envelope<K, T> = await this.get(
			`${this.indexBaseUrl}${path}?${params}`,
			this.indexApiKey,
		);
		return { items: env[key], next_cursor: env.next_cursor };
	}

	/** Drain a cursor-paginated Index collection over [fromHeight, toHeight]. */
	private async walk<K extends string, T>(
		path: string,
		key: K,
		fromHeight: number,
		toHeight: number,
		extraParams: Record<string, string> = {},
	): Promise<T[]> {
		const out: T[] = [];
		let cursor: string | null = null;
		do {
			const params = new URLSearchParams({
				to_height: String(toHeight),
				limit: String(PAGE_LIMIT),
				...extraParams,
			});
			// from_height and cursor are mutually exclusive — anchor the first page
			// by height, then page forward by cursor only.
			if (cursor) params.set("cursor", cursor);
			else params.set("from_height", String(fromHeight));
			const { items, next_cursor } = await this.getPage<K, T>(
				path,
				key,
				params,
			);
			out.push(...items);
			cursor = next_cursor;
		} while (cursor);
		return out;
	}

	/**
	 * Fetch ONE page of contract-call transactions filtered to `contractId`.
	 * Unlike walk(), this does NOT drain — the caller pages by feeding back
	 * next_cursor — so a sparse high-volume filter (e.g. a single contract over
	 * all history) costs one request per batch, not O(all-history) per tick.
	 * `cursor` is exclusive (rows strictly after it); on the first call pass
	 * `fromHeight` to anchor the backfill start instead.
	 */
	async fetchContractCalls(
		contractId: string,
		opts: {
			toHeight: number;
			cursor?: string | null;
			fromHeight?: number;
			limit?: number;
		},
	): Promise<{ transactions: IndexTransactionRow[]; next_cursor: string | null }> {
		const params = new URLSearchParams({
			to_height: String(opts.toHeight),
			limit: String(opts.limit ?? PAGE_LIMIT),
			contract_id: contractId,
		});
		if (opts.cursor) params.set("cursor", opts.cursor);
		else params.set("from_height", String(opts.fromHeight ?? 0));
		const { items, next_cursor } = await this.getPage<
			"transactions",
			IndexTransactionRow
		>("/v1/index/transactions", "transactions", params);
		return { transactions: items, next_cursor };
	}

	walkBlocks(fromHeight: number, toHeight: number): Promise<IndexBlockRow[]> {
		return this.walk<"blocks", IndexBlockRow>(
			"/v1/index/blocks",
			"blocks",
			fromHeight,
			toHeight,
		);
	}

	walkEvents(
		eventType: string,
		fromHeight: number,
		toHeight: number,
	): Promise<IndexEventRow[]> {
		return this.walk<"events", IndexEventRow>(
			"/v1/index/events",
			"events",
			fromHeight,
			toHeight,
			{ event_type: eventType },
		);
	}

	walkTransactions(
		fromHeight: number,
		toHeight: number,
	): Promise<IndexTransactionRow[]> {
		return this.walk<"transactions", IndexTransactionRow>(
			"/v1/index/transactions",
			"transactions",
			fromHeight,
			toHeight,
		);
	}

	/** Canonical tip height from the Streams clock. */
	async getStreamsTip(): Promise<number> {
		const tip = await this.get<{ block_height: number }>(
			`${this.streamsBaseUrl}/v1/streams/tip`,
			this.streamsApiKey,
		);
		return Number(tip.block_height) || 0;
	}

	/**
	 * Highest block height the Index data plane can serve (tip is inline in every
	 * envelope). This is the data-availability bound — a consumer must not
	 * process past it, even if the Streams clock is ahead.
	 */
	async getIndexTip(): Promise<number> {
		const env = await this.get<{ tip: { block_height: number } }>(
			`${this.indexBaseUrl}/v1/index/blocks?limit=1`,
			this.indexApiKey,
		);
		return Number(env.tip?.block_height) || 0;
	}

	/** Reorgs since a resume token (wall-clock `detected_at`-keyed). */
	async listReorgs(
		since: string,
	): Promise<{ reorgs: StreamsReorgRow[]; next_since: string | null }> {
		const params = new URLSearchParams({ since });
		return this.get(
			`${this.streamsBaseUrl}/v1/streams/reorgs?${params}`,
			this.streamsApiKey,
		);
	}
}
