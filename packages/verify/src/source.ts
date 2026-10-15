// Proof data sources. Everything a source returns is untrusted: verifyBlock
// checks every byte against the checkpoint, so a lying source can make a
// check fail but never pass.
import type { SpvProof } from "@secondlayer/stacks/bitcoin";
import { type Bytes, unhex } from "./bytes.ts";

/** Sortition preimage behind a consensus hash. */
export interface BurnPreimage {
	preimage: Bytes;
	/** The source's claimed burn height: a hint for how far to sync Bitcoin headers, never trusted. */
	burnHeight: number;
}

/** Node RPC `/v2/clarity/marf/<path>?proof=1` answer. */
export interface MarfProofResponse {
	/** Value string as Clarity stored it (hex for Clarity values), 0x prefix tolerated. */
	data: string;
	/** Consensus-serialized TrieMerkleProof. */
	proof: Bytes;
}

/** One storage-layer MARF write (`state_writes` row), in block write order. */
export interface StateWrite {
	/** Null for block-level writes outside any transaction. */
	tx_index: number | null;
	ordinal: number;
	/** Full MARF key, e.g. `vm::<contract>::0::<map>::<key hex>`. */
	key: string;
	/** Hex of the stored value string's UTF-8 bytes. */
	value_hex: string;
}

/** A `vm_events` write row, as the Index API serves it. */
export interface VmEventRow {
	event_type: "var_set" | "map_set" | "map_insert" | "map_delete";
	/** The row's ordinal within the block. */
	event_index: number;
	tx_id?: string;
	tx_index?: number;
	contract_id: string;
	var_name?: string | null;
	map?: string | null;
	raw_key?: string | null;
	raw_value?: string | null;
}

/** An epoch 2.x header and the consensus hash it commits to. */
export interface Epoch2HeaderResponse {
	/** Consensus-serialized StacksBlockHeader. */
	header: Bytes;
	consensusHash: Bytes;
}

export interface ProofSource {
	/** Raw Nakamoto block bytes (header first), by block id or height. */
	getBlock(ref: string | number): Promise<Bytes>;
	/**
	 * Epoch 2.x block header by index block hash: blocks below the checkpoint
	 * from before Nakamoto. Without it only Nakamoto blocks verify.
	 */
	getEpoch2Header?(blockId: string): Promise<Epoch2HeaderResponse>;
	/**
	 * MARF inclusion proof for a 32-byte path at `tipId`; null when the key is
	 * absent. Blocks below the checkpoint also ask for
	 * `__MARF_BLOCK_HEIGHT_TO_HASH::<height>`, whose value is no stored string:
	 * only `proof` is read for it.
	 */
	getMarfProof(
		pathHex: string,
		tipId: string,
	): Promise<MarfProofResponse | null>;
	/** State witness (wire v3) for a block. */
	getWitness(blockId: string): Promise<Bytes>;
	getBurnPreimage(consensusHash: string): Promise<BurnPreimage>;
	/** Raw 80-byte Bitcoin headers (hex or bytes) from height `from`. */
	getBitcoinHeaders(from: number, count: number): Promise<(string | Bytes)[]>;
	/**
	 * Every MARF write of the block, in ordinal order; null (or empty) when
	 * the source has none for it. Names the block's diff.
	 */
	getStateWrites?(height: number): Promise<StateWrite[] | null>;
	/** Indexed vm_events write rows of the block, checked against its proven diff. */
	getVmEvents?(height: number): Promise<VmEventRow[]>;
	/**
	 * A Bitcoin tx, its merkle branch and block header, by display-order txid.
	 * Untrusted: `verifyBitcoinTx` re-checks every byte.
	 */
	getBitcoinTxProof?(txid: string): Promise<SpvProof>;
}

/**
 * Thrown when a proof source request fails.
 *
 * It carries the request `url`, the HTTP `status` (null when there was none)
 * and the detail.
 */
export class SourceError extends Error {
	override readonly name = "SourceError";
	constructor(
		readonly url: string,
		readonly status: number | null,
		detail: string,
	) {
		super(`${url}: ${detail}`);
	}
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface HttpOptions {
	headers?: Record<string, string>;
	fetch?: Fetch;
}

const MAX_ATTEMPTS = 3;
const MAX_RETRY_SECONDS = 10;

/** GET with retries on 429 and 503 (honoring retry-after); null on 404. */
async function get(
	url: string,
	opts: HttpOptions,
	attempt = 1,
): Promise<Response | null> {
	const doFetch = opts.fetch ?? fetch;
	let res: Response;
	try {
		res = await doFetch(url, { headers: opts.headers });
	} catch (err) {
		throw new SourceError(url, null, (err as Error).message);
	}
	if (res.status === 404) return null;
	if ((res.status === 503 || res.status === 429) && attempt < MAX_ATTEMPTS) {
		const header = res.headers.get("retry-after");
		const seconds = header === null ? 1 : Number(header);
		const wait = Number.isFinite(seconds)
			? Math.min(Math.max(seconds, 0), MAX_RETRY_SECONDS)
			: 1;
		await new Promise((r) => setTimeout(r, wait * 1000));
		return get(url, opts, attempt + 1);
	}
	if (!res.ok) throw new SourceError(url, res.status, `HTTP ${res.status}`);
	return res;
}

async function getJson<T>(url: string, opts: HttpOptions): Promise<T | null> {
	const res = await get(url, opts);
	return res ? ((await res.json()) as T) : null;
}

async function getBytes(url: string, opts: HttpOptions): Promise<Bytes | null> {
	const res = await get(url, opts);
	return res ? new Uint8Array(await res.arrayBuffer()) : null;
}

const required = <T>(url: string, v: T | null): T => {
	if (v === null) throw new SourceError(url, 404, "not found");
	return v;
};

const trimSlash = (s: string) => s.replace(/\/+$/, "");

type MarfJson = { data: string; proof?: string; marf_proof?: string };

type HeadersJson = { header?: unknown; consensus_hash?: unknown }[];

/** The first entry of a node `/v2/headers/1?tip=<id>` answer: the tip itself. */
const toEpoch2 = (url: string, j: HeadersJson | null): Epoch2HeaderResponse => {
	const tip = required(url, j)[0];
	if (typeof tip?.header !== "string" || typeof tip.consensus_hash !== "string")
		throw new SourceError(url, 200, "answer needs header and consensus_hash");
	return {
		header: unhex(tip.header),
		consensusHash: unhex(tip.consensus_hash),
	};
};

const toMarf = (url: string, j: MarfJson | null): MarfProofResponse | null => {
	if (j === null) return null;
	const proof = j.proof ?? j.marf_proof;
	if (typeof proof !== "string" || typeof j.data !== "string")
		throw new SourceError(url, 200, "MARF answer needs data and proof");
	return { data: j.data, proof: unhex(proof) };
};

const isHex = (v: unknown): v is string =>
	typeof v === "string" && /^(0x)?([0-9a-f]{2})+$/i.test(v);
const isCount = (v: unknown): v is number =>
	typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Decode `/v1/proofs/bitcoin-tx/{txid}` into an `SpvProof`. */
const toBitcoinTxProof = (url: string, j: unknown): SpvProof => {
	const w = j as Record<string, unknown> | null;
	if (
		!w ||
		!isHex(w.txid) ||
		!isHex(w.raw_tx) ||
		!isHex(w.header) ||
		!isCount(w.block_height) ||
		!isCount(w.tx_index) ||
		!isCount(w.tx_count) ||
		!Array.isArray(w.siblings) ||
		!w.siblings.every(isHex)
	)
		throw new SourceError(
			url,
			200,
			"bitcoin tx proof needs txid, raw_tx, header, block_height, tx_index, tx_count and siblings",
		);
	return {
		rawTx: unhex(w.raw_tx),
		txidInternal: unhex(w.txid).reverse(),
		header: unhex(w.header),
		height: w.block_height,
		merkle: {
			siblings: (w.siblings as string[]).map(unhex),
			txIndex: w.tx_index,
			txCount: w.tx_count,
		},
	};
};

/** The hosted API. */
export const DEFAULT_API_URL = "https://api.secondlayer.tools";

/** Options for reading proofs from the Secondlayer API. */
export interface SecondlayerSourceOptions {
	/** API origin. Defaults to {@link DEFAULT_API_URL}. */
	baseUrl?: string;
	/**
	 * Optional. Proofs are keyless; a key raises the rate limit. Required for
	 * `rows: true` (metered Index reads). Sent as `Authorization: Bearer`.
	 */
	apiKey?: string;
	fetch?: Fetch;
}

const VM_WRITE_TYPES = [
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
] as const;
const PAGE = 1000;

/** Follow `next_cursor` until a page comes back empty. Null when the first page 404s. */
async function pages<T>(
	field: string,
	url: string,
	http: HttpOptions,
): Promise<T[] | null> {
	const out: T[] = [];
	let cursor: string | null = null;
	for (;;) {
		const page: string = cursor
			? `${url}&cursor=${encodeURIComponent(cursor)}`
			: url;
		const j = await getJson<Record<string, unknown>>(page, http);
		if (j === null) return cursor === null ? null : out;
		const rows = j[field];
		if (!Array.isArray(rows))
			throw new SourceError(page, 200, `answer has no ${field} array`);
		out.push(...(rows as T[]));
		const next = j.next_cursor;
		if (rows.length < PAGE || typeof next !== "string" || next === cursor)
			return out;
		cursor = next;
	}
}

// Both sources keep their origin and account key in constructor closures, not
// fields: nothing leaks through a spread, a log or JSON.stringify.

/**
 * Reads every proof input from the Secondlayer API.
 *
 * Blocks, epoch 2.x headers, MARF proofs, witnesses, burn preimages, Bitcoin
 * headers and each block's state writes come from `/v1/proofs/*`, which is free
 * and rate limited. Indexed `vm_events` rows come from the Index API as metered
 * rows, and are read only when `verifyBlock` gets `rows: true`. Methods are own
 * properties, so a partial source spreads over it:
 * `{ ...new SecondlayerProofSource(o), ...new NodeRpcProofSource(n) }`.
 */
export class SecondlayerProofSource implements ProofSource {
	/** Raw block bytes, header first, by block id or height. */
	getBlock: (ref: string | number) => Promise<Bytes>;
	/** An epoch 2.x header and its consensus hash, by index block hash. */
	getEpoch2Header: (blockId: string) => Promise<Epoch2HeaderResponse>;
	/**
	 * A MARF inclusion proof for a path at a tip.
	 *
	 * It is null when the key is absent.
	 */
	getMarfProof: (
		pathHex: string,
		tipId: string,
	) => Promise<MarfProofResponse | null>;
	/** The state witness for a block. */
	getWitness: (blockId: string) => Promise<Bytes>;
	/** The burn preimage behind a consensus hash. */
	getBurnPreimage: (consensusHash: string) => Promise<BurnPreimage>;
	/** Raw 80-byte Bitcoin headers, `count` of them from height `from`. */
	getBitcoinHeaders: (from: number, count: number) => Promise<string[]>;
	/**
	 * Every MARF write of a block, in ordinal order.
	 *
	 * It is null when there are none.
	 */
	getStateWrites: (height: number) => Promise<StateWrite[] | null>;
	/** The indexed `vm_events` write rows of a block, from the Index API. */
	getVmEvents: (height: number) => Promise<VmEventRow[]>;
	/**
	 * A Bitcoin tx, its merkle branch and header, by txid.
	 *
	 * The txid is display-order hex.
	 */
	getBitcoinTxProof: (txid: string) => Promise<SpvProof>;

	constructor(opts: SecondlayerSourceOptions = {}) {
		const base = trimSlash(opts.baseUrl ?? DEFAULT_API_URL);
		const http: HttpOptions = {
			headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
			fetch: opts.fetch,
		};

		this.getBlock = async (ref) => {
			const url =
				typeof ref === "number"
					? `${base}/v1/proofs/block/height/${ref}`
					: `${base}/v1/proofs/block/${ref}`;
			return required(url, await getBytes(url, http));
		};

		this.getEpoch2Header = async (blockId) => {
			const url = `${base}/v1/proofs/epoch2-header/${blockId}`;
			return toEpoch2(url, await getJson<HeadersJson>(url, http));
		};

		this.getMarfProof = async (pathHex, tipId) => {
			const url = `${base}/v1/proofs/marf/${pathHex}?tip=${tipId}`;
			return toMarf(url, await getJson<MarfJson>(url, http));
		};

		this.getWitness = async (blockId) => {
			const url = `${base}/v1/proofs/witness/${blockId}`;
			return required(url, await getBytes(url, http));
		};

		this.getBurnPreimage = async (consensusHash) => {
			const url = `${base}/v1/proofs/burn/${consensusHash}`;
			const j = required(
				url,
				await getJson<{ burn_height: number; preimage: string }>(url, http),
			);
			return { preimage: unhex(j.preimage), burnHeight: j.burn_height };
		};

		this.getBitcoinHeaders = async (from, count) => {
			const url = `${base}/v1/proofs/bitcoin-headers?from=${from}&count=${count}`;
			const j = required(
				url,
				await getJson<{ from: number; headers: string[] }>(url, http),
			);
			if (j.from !== from)
				throw new SourceError(url, 200, `headers start at ${j.from}`);
			return j.headers;
		};

		this.getBitcoinTxProof = async (txid) => {
			const url = `${base}/v1/proofs/bitcoin-tx/${txid}`;
			return toBitcoinTxProof(
				url,
				required(url, await getJson<unknown>(url, http)),
			);
		};

		this.getStateWrites = async (height) => {
			const url = `${base}/v1/proofs/writes/${height}`;
			const j = await getJson<{ state_writes?: unknown }>(url, http);
			if (j === null) return null;
			if (!Array.isArray(j.state_writes))
				throw new SourceError(url, 200, "answer has no state_writes array");
			return j.state_writes as StateWrite[];
		};

		this.getVmEvents = async (height) => {
			const eventsUrl = (type: string) =>
				`${base}/v1/index/events?event_type=${type}&from_height=${height}&to_height=${height}&limit=${PAGE}`;
			if (!opts.apiKey)
				throw new SourceError(
					eventsUrl(VM_WRITE_TYPES[0]),
					401,
					"rows: true reads metered Index events and needs an apiKey",
				);
			const out: VmEventRow[] = [];
			for (const type of VM_WRITE_TYPES) {
				const url = eventsUrl(type);
				out.push(...((await pages<VmEventRow>("events", url, http)) ?? []));
			}
			return out.sort((a, b) => a.event_index - b.event_index);
		};
	}
}

/** Options for reading proofs from a Stacks node. */
export interface NodeRpcSourceOptions {
	/** Stacks node RPC origin, e.g. `http://localhost:20443`. */
	nodeUrl: string;
	fetch?: Fetch;
}

/**
 * Reads blocks, epoch 2.x headers and MARF proofs from a Stacks node.
 *
 * It uses the node's RPC. Witnesses, burn preimages and Bitcoin headers need
 * another source: spread this over one.
 */
export class NodeRpcProofSource
	implements Pick<ProofSource, "getBlock" | "getEpoch2Header" | "getMarfProof">
{
	/** Raw block bytes, header first, by block id or height. */
	getBlock: (ref: string | number) => Promise<Bytes>;
	/** An epoch 2.x header and its consensus hash, by index block hash. */
	getEpoch2Header: (blockId: string) => Promise<Epoch2HeaderResponse>;
	/**
	 * A MARF inclusion proof for a path at a tip.
	 *
	 * It is null when the key is absent.
	 */
	getMarfProof: (
		pathHex: string,
		tipId: string,
	) => Promise<MarfProofResponse | null>;

	constructor(opts: NodeRpcSourceOptions) {
		const base = trimSlash(opts.nodeUrl);
		const http: HttpOptions = { fetch: opts.fetch };

		this.getBlock = async (ref) => {
			const url =
				typeof ref === "number"
					? `${base}/v3/blocks/height/${ref}`
					: `${base}/v3/blocks/${ref}`;
			return required(url, await getBytes(url, http));
		};

		this.getEpoch2Header = async (blockId) => {
			const url = `${base}/v2/headers/1?tip=${blockId}`;
			return toEpoch2(url, await getJson<HeadersJson>(url, http));
		};

		this.getMarfProof = async (pathHex, tipId) => {
			const url = `${base}/v2/clarity/marf/${pathHex}?tip=${tipId}&proof=1`;
			return toMarf(url, await getJson<MarfJson>(url, http));
		};
	}
}
