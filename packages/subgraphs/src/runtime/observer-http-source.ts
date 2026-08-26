import type { Block, Event, Transaction } from "@secondlayer/shared/db";
import type { BlockData } from "./batch-loader.ts";
import type { BlockSource } from "./block-source.ts";

/** Duplicated from indexer — do not import `@secondlayer/indexer` (cycle). */
const OBSERVER_HTTP_EXPORT_PATH = "/internal/observer-events";

export type ObserverHttpFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type ObserverHttpBlockSourceOpts = {
	/** e.g. http://127.0.0.1:3700 — trailing slash stripped */
	baseUrl: string;
	token?: string | null;
	fetch?: ObserverHttpFetch;
	/** Unused on the wire; list filtering is server-side. */
	network?: string;
};

type ObserverEventsNext = {
	after_height: number;
	after_index_block_hash: string;
};

type SbaObserverMessage = {
	path: string;
	payload: unknown;
	content_sha256: string;
	block_height: number | null;
	index_block_hash: string | null;
	received_at?: string;
};

type ObserverEventsResponse = {
	events: SbaObserverMessage[];
	next: ObserverEventsNext | null;
};

type ObserverTipResponse = {
	block_height: number;
	index_block_hash: string | null;
};

type ObserverTx = {
	txid?: string;
	tx_index?: number;
	tx_type?: string;
	sender_address?: string;
	status?: string;
	raw_result?: string | null;
	raw_tx?: string;
	contract_call?: { contract_id?: string; function_name?: string };
	smart_contract?: { contract_id?: string };
};

type ObserverEvent = {
	txid?: string;
	event_index?: number;
	type?: string;
	[key: string]: unknown;
};

type ObserverNewBlockPayload = {
	block_height?: number;
	block_hash?: string;
	parent_block_hash?: string;
	burn_block_height?: number;
	burn_block_hash?: string | null;
	index_block_hash?: string | null;
	timestamp?: number;
	block_time?: number;
	burn_block_time?: number;
	burn_block_timestamp?: number;
	transactions?: ObserverTx[];
	events?: ObserverEvent[];
};

function stripTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "");
}

function blockTimestamp(payload: ObserverNewBlockPayload): number {
	for (const value of [
		payload.timestamp,
		payload.block_time,
		payload.burn_block_time,
		payload.burn_block_timestamp,
	]) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return 0;
}

function eventData(event: ObserverEvent): unknown {
	if (typeof event.type === "string" && event.type in event) {
		return event[event.type] ?? {};
	}
	return {};
}

/** Map a `/new_block` observer payload into subgraph `BlockData`. No Hiro. */
export function mapNewBlockPayloadToBlockData(payload: unknown): BlockData {
	const p = payload as ObserverNewBlockPayload;
	if (
		typeof p.block_height !== "number" ||
		!Number.isFinite(p.block_height) ||
		typeof p.index_block_hash !== "string" ||
		p.index_block_hash.length === 0
	) {
		throw new Error(
			"observer /new_block payload missing block_height or index_block_hash",
		);
	}

	const height = p.block_height;
	const block = {
		height,
		hash: p.block_hash ?? "",
		parent_hash: p.parent_block_hash ?? "",
		burn_block_height: p.burn_block_height ?? 0,
		burn_block_hash: p.burn_block_hash ?? null,
		index_block_hash: p.index_block_hash,
		timestamp: blockTimestamp(p),
		canonical: true,
		created_at: new Date(0),
	} as Block;

	const txs: Transaction[] = (p.transactions ?? []).map((tx) => {
		let contractId: string | null = null;
		let functionName: string | null = null;
		if (tx.tx_type === "contract_call" && tx.contract_call) {
			contractId = tx.contract_call.contract_id ?? null;
			functionName = tx.contract_call.function_name ?? null;
		} else if (tx.tx_type === "smart_contract" && tx.smart_contract) {
			contractId = tx.smart_contract.contract_id ?? null;
		}
		return {
			tx_id: tx.txid ?? "",
			block_height: height,
			tx_index: tx.tx_index ?? 0,
			type: tx.tx_type ?? "",
			sender: tx.sender_address ?? "",
			status: tx.status ?? "success",
			contract_id: contractId,
			function_name: functionName,
			function_args: [],
			raw_result: tx.raw_result ?? null,
			raw_tx: tx.raw_tx ?? "",
			created_at: new Date(0),
		} as Transaction;
	});

	const events: Event[] = (p.events ?? []).map((event) => {
		const txId = event.txid ?? "";
		const eventIndex = event.event_index ?? 0;
		return {
			id: `${txId}#${eventIndex}`,
			tx_id: txId,
			block_height: height,
			event_index: eventIndex,
			type: event.type ?? "",
			data: eventData(event),
			created_at: new Date(0),
		} as Event;
	});

	return { block, txs, events };
}

/**
 * Experimental BlockSource: pages indexer `/internal/observer-events` and maps
 * raw `/new_block` bodies to `BlockData`. Not the production default.
 */
export class ObserverHttpBlockSource implements BlockSource {
	private readonly baseUrl: string;
	private readonly token: string | null;
	private readonly fetchFn: ObserverHttpFetch;

	constructor(opts: ObserverHttpBlockSourceOpts) {
		this.baseUrl = stripTrailingSlash(opts.baseUrl);
		this.token = opts.token ?? null;
		this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
	}

	private headers(): Record<string, string> {
		if (!this.token) return {};
		return { Authorization: `Bearer ${this.token}` };
	}

	async getTip(): Promise<number> {
		const res = await this.fetchFn(
			`${this.baseUrl}${OBSERVER_HTTP_EXPORT_PATH}/tip`,
			{ headers: this.headers() },
		);
		if (!res.ok) {
			throw new Error(
				`observer tip HTTP ${res.status}: ${await res.text().catch(() => "")}`,
			);
		}
		let body: ObserverTipResponse;
		try {
			body = (await res.json()) as ObserverTipResponse;
		} catch (err) {
			throw new Error(
				`observer tip invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (
			typeof body.block_height !== "number" ||
			!Number.isFinite(body.block_height)
		) {
			throw new Error("observer tip missing block_height");
		}
		return body.block_height;
	}

	async loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>> {
		const result = new Map<number, BlockData>();
		let afterHeight: number | undefined =
			fromHeight > 0 ? fromHeight - 1 : undefined;
		let afterIndexBlockHash: string | undefined;

		for (;;) {
			const url = new URL(`${this.baseUrl}${OBSERVER_HTTP_EXPORT_PATH}`);
			url.searchParams.set("path", "/new_block");
			url.searchParams.set("limit", "100");
			if (afterHeight != null) {
				url.searchParams.set("after_height", String(afterHeight));
			}
			if (afterIndexBlockHash) {
				url.searchParams.set("after_index_block_hash", afterIndexBlockHash);
			}

			const res = await this.fetchFn(url.toString(), {
				headers: this.headers(),
			});
			if (!res.ok) {
				throw new Error(
					`observer events HTTP ${res.status}: ${await res.text().catch(() => "")}`,
				);
			}

			let body: ObserverEventsResponse;
			try {
				body = (await res.json()) as ObserverEventsResponse;
			} catch (err) {
				throw new Error(
					`observer events invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			let pastTo = false;
			for (const message of body.events ?? []) {
				if (message.path === "/new_burn_block") continue;
				const height = (message.payload as ObserverNewBlockPayload)
					?.block_height;
				if (typeof height === "number" && height > toHeight) {
					pastTo = true;
					break;
				}
				const data = mapNewBlockPayloadToBlockData(message.payload);
				const h = data.block.height;
				if (h >= fromHeight && h <= toHeight) {
					result.set(h, data);
				}
			}

			if (pastTo || body.next == null) break;
			afterHeight = body.next.after_height;
			afterIndexBlockHash = body.next.after_index_block_hash;
		}

		return result;
	}
}
