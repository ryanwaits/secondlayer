import { bytesToHex, hexToBytes, without0x } from "../utils/encoding.ts";
import { type MerkleProof, buildMerkleProof, rootFromProof } from "./merkle.ts";
import { parseBitcoinTx, parseBlockHeader, reverseBytes } from "./serialize.ts";

/**
 * A self-contained Bitcoin SPV proof: everything the SIP-044 built-ins need to
 * prove a tx (and one of its outputs) is committed in a confirmed block. Hashes
 * are internal byte order throughout.
 */
export interface SpvProof {
	rawTx: Uint8Array;
	/** The tx's txid, internal order — the merkle leaf. */
	txidInternal: Uint8Array;
	/** Output index of interest, if the proof targets a specific output. */
	vout?: number;
	merkle: MerkleProof;
	/** The 80-byte block header that commits the tx. */
	header: Uint8Array;
	/** Bitcoin block height. */
	height: number;
}

/** The block context a `ProofSource` resolves for a confirmed tx. */
export interface BlockForTx {
	/** 80-byte block header. */
	header: Uint8Array;
	height: number;
	/** All of the block's txids, internal order, in block order. */
	txidsInternal: Uint8Array[];
	/** Index of the target tx within the block. */
	txIndex: number;
}

/**
 * Where proof inputs come from. The default is the integrator's own Bitcoin node
 * (`bitcoinRpcSource`) — trustless; a hosted Esplora-compatible endpoint
 * (`esploraSource`) is the fallback. `buildTxProof` independently re-checks
 * whatever a source returns, so a wrong or hostile source fails loudly rather
 * than producing a bad proof.
 */
export interface ProofSource {
	/** Raw (serialized) tx bytes for a txid (display-order hex). */
	getRawTx(txid: string): Promise<Uint8Array>;
	/** The confirming block's header, height, and txid set for a txid. */
	getBlockForTx(txid: string): Promise<BlockForTx>;
}

function normalizeTxid(txid: string): string {
	return without0x(txid).toLowerCase();
}

/**
 * Locate `txid` in a block's txid set and assemble its `BlockForTx`. Owns the
 * display→internal byte-order reversal (`reverseBytes`) so the ProofSources
 * can't drift on the one operation a silent merkle-root mismatch would hide.
 * `txidsDisplay` are display-order hex txids as returned by Core / Esplora.
 */
function assembleBlockForTx(args: {
	txid: string;
	blockId: string;
	headerHex: string;
	height: number;
	txidsDisplay: string[];
}): BlockForTx {
	const txIndex = args.txidsDisplay.indexOf(normalizeTxid(args.txid));
	if (txIndex < 0) {
		throw new Error(`tx ${args.txid} not found in block ${args.blockId}`);
	}
	return {
		header: hexToBytes(args.headerHex),
		height: args.height,
		txidsInternal: args.txidsDisplay.map((t) => reverseBytes(hexToBytes(t))),
		txIndex,
	};
}

/**
 * Assemble an `SpvProof` for a txid from a `ProofSource`, validating every claim
 * the source makes:
 *  - the returned raw tx actually hashes to the requested txid,
 *  - the claimed `txIndex` points at that txid in the block, and
 *  - the resulting merkle proof folds back to the block header's merkle root.
 * Any mismatch throws — the proof is never returned half-trusted.
 */
export async function buildTxProof(
	source: ProofSource,
	params: { txid: string; vout?: number },
): Promise<SpvProof> {
	const { txid, vout } = params;
	const want = normalizeTxid(txid);

	const [rawTx, block] = await Promise.all([
		source.getRawTx(txid),
		source.getBlockForTx(txid),
	]);

	const parsed = parseBitcoinTx(rawTx);
	const gotDisplay = bytesToHex(reverseBytes(parsed.txidInternal));
	if (gotDisplay !== want) {
		throw new Error(
			`source returned a tx whose id ${gotDisplay} does not match requested ${want}`,
		);
	}

	const atIndex = block.txidsInternal[block.txIndex];
	if (!atIndex || bytesToHex(atIndex) !== bytesToHex(parsed.txidInternal)) {
		throw new Error(
			`source txIndex ${block.txIndex} does not point at tx ${want}`,
		);
	}

	const merkle = buildMerkleProof(block.txidsInternal, block.txIndex);

	const headerRoot = parseBlockHeader(block.header).merkleRoot;
	const computed = rootFromProof(parsed.txidInternal, merkle);
	if (bytesToHex(computed) !== bytesToHex(headerRoot)) {
		throw new Error(
			"constructed merkle proof does not reconcile with the block header merkle root",
		);
	}

	return {
		rawTx,
		txidInternal: parsed.txidInternal,
		vout,
		merkle,
		header: block.header,
		height: block.height,
	};
}

/**
 * Compose sources into an ordered fallback chain: each call tries them in turn
 * and returns the first success, throwing the last error if all fail. Put the
 * trustless integrator node first and a hosted endpoint last.
 */
export function fallbackProofSource(sources: ProofSource[]): ProofSource {
	if (sources.length === 0) {
		throw new Error("fallbackProofSource: at least one source is required");
	}
	async function firstSuccess<T>(
		fn: (s: ProofSource) => Promise<T>,
	): Promise<T> {
		let lastError: unknown;
		for (const source of sources) {
			try {
				return await fn(source);
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError;
	}
	return {
		getRawTx: (txid) => firstSuccess((s) => s.getRawTx(txid)),
		getBlockForTx: (txid) => firstSuccess((s) => s.getBlockForTx(txid)),
	};
}

export interface BitcoinRpcConfig {
	/** Bitcoin Core JSON-RPC endpoint URL. */
	url: string;
	/** Basic auth — `{ username, password }` or a pre-encoded base64 string. */
	auth?: { username: string; password: string } | string;
	/** Override the fetch implementation (testing / custom agents). */
	fetch?: typeof fetch;
}

/**
 * A `ProofSource` backed by the integrator's own Bitcoin Core node over
 * JSON-RPC. This is the trustless default. The node must run with `-txindex`
 * (or the tx must be in the mempool's block view) so `getrawtransaction` can
 * resolve the confirming block.
 */
export function bitcoinRpcSource(config: BitcoinRpcConfig): ProofSource {
	const doFetch = config.fetch ?? fetch;

	async function rpc<T>(method: string, rpcParams: unknown[]): Promise<T> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
		};
		if (config.auth) {
			const basic =
				typeof config.auth === "string"
					? config.auth
					: btoa(`${config.auth.username}:${config.auth.password}`);
			headers.authorization = `Basic ${basic}`;
		}
		const res = await doFetch(config.url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				jsonrpc: "1.0",
				id: "secondlayer",
				method,
				params: rpcParams,
			}),
		});
		if (!res.ok) {
			throw new Error(`bitcoin rpc ${method} failed: HTTP ${res.status}`);
		}
		const json = (await res.json()) as {
			result: T;
			error: { message: string } | null;
		};
		if (json.error) {
			throw new Error(`bitcoin rpc ${method} error: ${json.error.message}`);
		}
		return json.result;
	}

	return {
		async getRawTx(txid) {
			return hexToBytes(await rpc<string>("getrawtransaction", [txid, false]));
		},
		async getBlockForTx(txid) {
			const tx = await rpc<{ blockhash?: string }>("getrawtransaction", [
				txid,
				true,
			]);
			if (!tx.blockhash) {
				throw new Error(
					`tx ${txid} is not in a block (node needs -txindex, or the tx is unconfirmed)`,
				);
			}
			const block = await rpc<{ tx: string[]; height: number }>("getblock", [
				tx.blockhash,
				1,
			]);
			const header = await rpc<string>("getblockheader", [tx.blockhash, false]);
			return assembleBlockForTx({
				txid,
				blockId: tx.blockhash,
				headerHex: header,
				height: block.height,
				txidsDisplay: block.tx,
			});
		},
	};
}

export interface EsploraConfig {
	/** Esplora REST base URL, e.g. `https://blockstream.info/api` or a self-hosted instance. */
	url: string;
	/** Override the fetch implementation. */
	fetch?: typeof fetch;
}

/**
 * A `ProofSource` backed by an Esplora REST API (self-hosted, or a hosted
 * provider as a fallback). Provider-agnostic: any Esplora-compatible endpoint
 * works. Use as the hosted fallback behind `bitcoinRpcSource`.
 */
export function esploraSource(config: EsploraConfig): ProofSource {
	const doFetch = config.fetch ?? fetch;
	const base = config.url.replace(/\/+$/, "");

	async function get(path: string): Promise<Response> {
		const res = await doFetch(`${base}${path}`);
		if (!res.ok) {
			throw new Error(`esplora GET ${path} failed: HTTP ${res.status}`);
		}
		return res;
	}

	return {
		async getRawTx(txid) {
			return hexToBytes((await (await get(`/tx/${txid}/hex`)).text()).trim());
		},
		async getBlockForTx(txid) {
			const status = (await (await get(`/tx/${txid}`)).json()) as {
				status: {
					confirmed: boolean;
					block_height: number;
					block_hash: string;
				};
			};
			if (!status.status.confirmed) {
				throw new Error(`tx ${txid} is unconfirmed`);
			}
			const blockHashHex = status.status.block_hash;
			const header = (
				await (await get(`/block/${blockHashHex}/header`)).text()
			).trim();
			const txids = (await (
				await get(`/block/${blockHashHex}/txids`)
			).json()) as string[];
			return assembleBlockForTx({
				txid,
				blockId: blockHashHex,
				headerHex: header,
				height: status.status.block_height,
				txidsDisplay: txids,
			});
		},
	};
}
