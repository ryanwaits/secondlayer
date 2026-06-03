import { defaultInternalIndexApiKey } from "@secondlayer/shared/index-internal-auth";
import type {
	IndexBlockRow,
	IndexEventRow,
	IndexTransactionRow,
} from "./reconstruct.ts";

/**
 * Minimal HTTP client for the public Index + Streams APIs, used by
 * `PublicApiBlockSource`. Hand-rolled (not the SDK) because `@secondlayer/sdk`
 * depends on `@secondlayer/subgraphs` — importing it here would cycle. Phase 1
 * only needs cursor-paginated reads + the Streams clock, so the surface is tiny.
 */

const PAGE_LIMIT = 1000;

type Envelope<K extends string, T> = {
	[P in K]: T[];
} & { next_cursor: string | null };

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
		const res = await fetch(url, {
			headers: { authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) {
			throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as T;
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
				from_height: String(fromHeight),
				to_height: String(toHeight),
				limit: String(PAGE_LIMIT),
				...extraParams,
			});
			if (cursor) params.set("cursor", cursor);
			const env: Envelope<K, T> = await this.get(
				`${this.indexBaseUrl}${path}?${params}`,
				this.indexApiKey,
			);
			out.push(...env[key]);
			cursor = env.next_cursor;
		} while (cursor);
		return out;
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
	async getTip(): Promise<number> {
		const tip = await this.get<{ block_height: number }>(
			`${this.streamsBaseUrl}/v1/streams/tip`,
			this.streamsApiKey,
		);
		return Number(tip.block_height) || 0;
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
