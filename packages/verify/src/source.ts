// Proof data sources. Everything a source returns is untrusted: verifyBlock
// checks every byte against the checkpoint, so a lying source can make a
// check fail but never pass.
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

export interface ProofSource {
	/** Raw Nakamoto block bytes (header first), by block id or height. */
	getBlock(ref: string | number): Promise<Bytes>;
	/** MARF inclusion proof for a 32-byte path at `tipId`; null when the key is absent. */
	getMarfProof(
		pathHex: string,
		tipId: string,
	): Promise<MarfProofResponse | null>;
	/** State witness (wire v3) for a block. */
	getWitness(blockId: string): Promise<Bytes>;
	getBurnPreimage(consensusHash: string): Promise<BurnPreimage>;
	/** Raw 80-byte Bitcoin headers (hex or bytes) from height `from`. */
	getBitcoinHeaders(from: number, count: number): Promise<(string | Bytes)[]>;
	/** Every MARF write of the block; null when the source has none for it. */
	getStateWrites?(height: number): Promise<StateWrite[] | null>;
	/** Indexed vm_events write rows of the block, checked against its proven diff. */
	getVmEvents?(height: number): Promise<VmEventRow[]>;
}

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

/** GET with retries on 503 (honoring retry-after); null on 404. */
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
	if (res.status === 503 && attempt < MAX_ATTEMPTS) {
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

const toMarf = (url: string, j: MarfJson | null): MarfProofResponse | null => {
	if (j === null) return null;
	const proof = j.proof ?? j.marf_proof;
	if (typeof proof !== "string" || typeof j.data !== "string")
		throw new SourceError(url, 200, "MARF answer needs data and proof");
	return { data: j.data, proof: unhex(proof) };
};

export interface SecondlayerSourceOptions {
	/** API origin, e.g. `https://api.secondlayer.tools`. */
	baseUrl: string;
	/** Account key, sent as `Authorization: Bearer`. */
	apiKey: string;
	fetch?: Fetch;
}

const VM_WRITE_TYPES = [
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
] as const;
const PAGE = 1000;

/**
 * Every proof input from the Secondlayer API: `/v1/proofs/*` for blocks, MARF
 * proofs, witnesses, burn preimages and Bitcoin headers; the Index API for
 * state_writes and vm_events. Methods are own properties, so a partial source
 * spreads over it: `{ ...new SecondlayerProofSource(o), ...new NodeRpcProofSource(n) }`.
 */
export class SecondlayerProofSource implements ProofSource {
	readonly #base: string;
	readonly #http: HttpOptions;

	constructor(opts: SecondlayerSourceOptions) {
		this.#base = trimSlash(opts.baseUrl);
		this.#http = {
			headers: { authorization: `Bearer ${opts.apiKey}` },
			fetch: opts.fetch,
		};
	}

	getBlock = async (ref: string | number): Promise<Bytes> => {
		const url =
			typeof ref === "number"
				? `${this.#base}/v1/proofs/block/height/${ref}`
				: `${this.#base}/v1/proofs/block/${ref}`;
		return required(url, await getBytes(url, this.#http));
	};

	getMarfProof = async (
		pathHex: string,
		tipId: string,
	): Promise<MarfProofResponse | null> => {
		const url = `${this.#base}/v1/proofs/marf/${pathHex}?tip=${tipId}`;
		return toMarf(url, await getJson<MarfJson>(url, this.#http));
	};

	getWitness = async (blockId: string): Promise<Bytes> => {
		const url = `${this.#base}/v1/proofs/witness/${blockId}`;
		return required(url, await getBytes(url, this.#http));
	};

	getBurnPreimage = async (consensusHash: string): Promise<BurnPreimage> => {
		const url = `${this.#base}/v1/proofs/burn/${consensusHash}`;
		const j = required(
			url,
			await getJson<{ burn_height: number; preimage: string }>(url, this.#http),
		);
		return { preimage: unhex(j.preimage), burnHeight: j.burn_height };
	};

	getBitcoinHeaders = async (from: number, count: number) => {
		const url = `${this.#base}/v1/proofs/bitcoin-headers?from=${from}&count=${count}`;
		const j = required(
			url,
			await getJson<{ from: number; headers: string[] }>(url, this.#http),
		);
		if (j.from !== from)
			throw new SourceError(url, 200, `headers start at ${j.from}`);
		return j.headers;
	};

	getStateWrites = (height: number): Promise<StateWrite[] | null> =>
		this.#pages<StateWrite>(
			"state_writes",
			`${this.#base}/v1/index/state-writes?block_height=${height}&limit=${PAGE}`,
		);

	getVmEvents = async (height: number): Promise<VmEventRow[]> => {
		const out: VmEventRow[] = [];
		for (const type of VM_WRITE_TYPES) {
			const url = `${this.#base}/v1/index/events?event_type=${type}&from_height=${height}&to_height=${height}&limit=${PAGE}`;
			out.push(...((await this.#pages<VmEventRow>("events", url)) ?? []));
		}
		return out.sort((a, b) => a.event_index - b.event_index);
	};

	/** Follow `next_cursor` until a page comes back empty. Null when the first page 404s. */
	async #pages<T>(field: string, url: string): Promise<T[] | null> {
		const out: T[] = [];
		let cursor: string | null = null;
		for (;;) {
			const page: string = cursor
				? `${url}&cursor=${encodeURIComponent(cursor)}`
				: url;
			const j = await getJson<Record<string, unknown>>(page, this.#http);
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
}

export interface NodeRpcSourceOptions {
	/** Stacks node RPC origin, e.g. `http://localhost:20443`. */
	nodeUrl: string;
	fetch?: Fetch;
}

/**
 * Blocks and MARF proofs straight from a Stacks node's RPC. Witnesses, burn
 * preimages and Bitcoin headers need another source: spread this over one.
 */
export class NodeRpcProofSource
	implements Pick<ProofSource, "getBlock" | "getMarfProof">
{
	readonly #base: string;
	readonly #http: HttpOptions;

	constructor(opts: NodeRpcSourceOptions) {
		this.#base = trimSlash(opts.nodeUrl);
		this.#http = { fetch: opts.fetch };
	}

	getBlock = async (ref: string | number): Promise<Bytes> => {
		const url =
			typeof ref === "number"
				? `${this.#base}/v3/blocks/height/${ref}`
				: `${this.#base}/v3/blocks/${ref}`;
		return required(url, await getBytes(url, this.#http));
	};

	getMarfProof = async (
		pathHex: string,
		tipId: string,
	): Promise<MarfProofResponse | null> => {
		const url = `${this.#base}/v2/clarity/marf/${pathHex}?tip=${tipId}&proof=1`;
		return toMarf(url, await getJson<MarfJson>(url, this.#http));
	};
}
