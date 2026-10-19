import { parseBlock } from "@secondlayer/bitcoin/block";
import { type BitcoindCall, BitcoindRpcError, RPC_NO_SUCH_TX } from "./rpc.ts";

/**
 * Is a Bitcoin output spent, and by which transaction? Answered live from
 * the instance's own bitcoind (`-txindex`, Bitcoin Core 24 or later). This
 * is a lookup per outpoint, not an address or UTXO index: nothing is
 * stored but a small in-process memo.
 *
 *   1. `getrawtransaction` (txindex): the output exists, and its block.
 *   2. `gettxout(include_mempool=true)`: unspent, or spent in a block or in
 *      the mempool.
 *   3. `gettxspendingprevout`: the mempool spender, from the mempool's own
 *      spent-outpoint map.
 *   4. Otherwise it was spent in a block. bitcoind keeps no spender index,
 *      so walk back from the tip over raw blocks (`getblock` verbosity 0,
 *      parsed here) until an input spends it, down to the output's own
 *      block or `scanBlocks` below the tip, whichever is higher.
 *
 * The walk starts at the tip because the workload is a watcher polling each
 * block: a spend it has not yet seen sits in the newest blocks. A spend
 * deeper than the window still answers `spent: true`, with a null spender.
 *
 * Memo, per outpoint: the spender once found (re-checked as confirmed on
 * each read, so a reorg drops it), or "deeper than the window as of tip
 * H/hash" (re-checked by `getblockhash(H)`). Unspent and mempool answers are
 * never memoized, so a new mempool spend shows on the next read.
 */

/** One day of blocks. Each scanned block is one raw-block read (~2 MB). */
export const OUTSPEND_SCAN_BLOCKS = 144;

const DEFAULTS = {
	scanBlocks: OUTSPEND_SCAN_BLOCKS,
	/** Raw-block reads in flight at once, across every request. bitcoind's
	 *  RPC threads are shared with the node's other readers. */
	maxBlockReads: 2,
	/** Requests that may wait for a block-read slot before one is refused. */
	maxWaiting: 16,
	/** Parsed blocks kept: watchers polling at a new tip share one read. */
	blockCacheSize: 8,
	memoSize: 10_000,
};

export type OutspendOptions = Partial<typeof DEFAULTS>;

export type Outspend =
	| { txid: string; vout: number; spent: false }
	| {
			txid: string;
			vout: number;
			spent: true;
			spending_txid: string | null;
			spending_vin: number | null;
			confirmed: boolean;
			mempool: boolean;
			block_height: number | null;
			block_hash: string | null;
			note?: string;
	  };

/** The outpoint does not exist, or can never be spent. */
export class OutspendNotFoundError extends Error {}

/** Every block-read slot and waiting place is taken. */
export class OutspendBusyError extends Error {}

type VerboseTx = {
	txid: string;
	blockhash?: string;
	confirmations?: number;
	vin: Array<{ txid?: string; vout?: number }>;
	vout: Array<{ n: number; scriptPubKey: { hex: string } }>;
};

type BlockSpends = {
	prevHash: string;
	/** `txid:vout` spent in this block → the spender and its input index. */
	spends: Map<string, { txid: string; vin: number }>;
};

type Memo =
	| { kind: "spender"; txid: string }
	| { kind: "deeper"; tipHeight: number; tipHash: string };

const outpointKey = (txid: string, vout: number) => `${txid}:${vout}`;

/** Insert as newest, dropping the oldest past `limit`. */
function remember<K, V>(map: Map<K, V>, key: K, value: V, limit: number) {
	map.delete(key);
	map.set(key, value);
	if (map.size > limit) map.delete(map.keys().next().value as K);
}

function inputIndex(tx: VerboseTx, txid: string, vout: number): number | null {
	const i = tx.vin.findIndex(
		(input) => input.txid === txid && input.vout === vout,
	);
	return i < 0 ? null : i;
}

async function getTx(
	rpc: BitcoindCall,
	txid: string,
): Promise<VerboseTx | null> {
	try {
		return await rpc<VerboseTx>("getrawtransaction", [txid, true]);
	} catch (err) {
		if (err instanceof BitcoindRpcError && err.code === RPC_NO_SUCH_TX) {
			return null;
		}
		throw err;
	}
}

/** At most `max` tasks run; up to `maxWaiting` more queue; the rest refuse. */
function limiter(max: number, maxWaiting: number) {
	let active = 0;
	const waiting: Array<() => void> = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (active < max) active++;
		else if (waiting.length < maxWaiting) {
			await new Promise<void>((resolve) => waiting.push(resolve));
		} else {
			throw new OutspendBusyError("bitcoind is busy; retry shortly");
		}
		try {
			return await task();
		} finally {
			// Hand the slot straight to the next waiter, or free it.
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}

export function createOutspendLookup(options: OutspendOptions = {}) {
	const opts = { ...DEFAULTS, ...options };
	const memo = new Map<string, Memo>();
	const blocks = new Map<string, Promise<BlockSpends>>();
	const blockRead = limiter(opts.maxBlockReads, opts.maxWaiting);

	/** One raw-block read per hash, shared by every request asking for it. */
	function blockSpends(rpc: BitcoindCall, hash: string): Promise<BlockSpends> {
		const cached = blocks.get(hash);
		if (cached) return cached;
		const read = blockRead(async () => {
			const block = parseBlock(await rpc<string>("getblock", [hash, 0]));
			const spends = new Map<string, { txid: string; vin: number }>();
			for (const tx of block.txs) {
				tx.inputs.forEach((input, vin) => {
					spends.set(outpointKey(input.prevTxid, input.prevVout), {
						txid: tx.txid,
						vin,
					});
				});
			}
			return { prevHash: block.prevHash, spends };
		});
		remember(blocks, hash, read, opts.blockCacheSize);
		read.catch(() => blocks.delete(hash));
		return read;
	}

	const spentIn = (
		txid: string,
		vout: number,
		at: {
			spending_txid: string | null;
			spending_vin: number | null;
			confirmed: boolean;
			block_height?: number | null;
			block_hash?: string | null;
			note?: string;
		},
	): Outspend => ({
		txid,
		vout,
		spent: true,
		spending_txid: at.spending_txid,
		spending_vin: at.spending_vin,
		confirmed: at.confirmed,
		mempool: !at.confirmed,
		block_height: at.block_height ?? null,
		block_hash: at.block_hash ?? null,
		...(at.note ? { note: at.note } : {}),
	});

	const deeperNote = () =>
		`Spent in a block more than ${opts.scanBlocks} blocks below the tip. Lookups search that many blocks, so the spending transaction is not reported.`;

	/** The memo's confirmed answer, or null when it no longer holds. */
	async function fromMemo(
		rpc: BitcoindCall,
		txid: string,
		vout: number,
		known: Memo,
	): Promise<Outspend | null> {
		if (known.kind === "spender") {
			const spender = await getTx(rpc, known.txid);
			// `confirmations` is 0 when the block left the active chain.
			if (!spender?.blockhash || !(spender.confirmations ?? 0)) return null;
			const header = await rpc<{ height: number }>("getblockheader", [
				spender.blockhash,
				true,
			]);
			return spentIn(txid, vout, {
				spending_txid: known.txid,
				spending_vin: inputIndex(spender, txid, vout),
				confirmed: true,
				block_height: header.height,
				block_hash: spender.blockhash,
			});
		}
		const hash = await rpc<string>("getblockhash", [known.tipHeight]).catch(
			(err) => {
				// Height out of range: the chain got shorter.
				if (err instanceof BitcoindRpcError) return null;
				throw err;
			},
		);
		if (hash !== known.tipHash) return null;
		return spentIn(txid, vout, {
			spending_txid: null,
			spending_vin: null,
			confirmed: true,
			note: deeperNote(),
		});
	}

	return async function lookup(
		rpc: BitcoindCall,
		txid: string,
		vout: number,
	): Promise<Outspend> {
		const tx = await getTx(rpc, txid);
		if (!tx) {
			throw new OutspendNotFoundError("no Bitcoin transaction with that txid");
		}
		const output = tx.vout.find((o) => o.n === vout);
		if (!output) {
			throw new OutspendNotFoundError(
				`that transaction has ${tx.vout.length} outputs, so vout ${vout} does not exist`,
			);
		}
		// OP_RETURN outputs never enter the UTXO set, so gettxout would read
		// them as spent.
		if (output.scriptPubKey.hex.startsWith("6a")) {
			throw new OutspendNotFoundError(
				"that output is an OP_RETURN output, which can never be spent",
			);
		}

		const utxo = await rpc<unknown>("gettxout", [txid, vout, true]);
		if (utxo !== null) return { txid, vout, spent: false };

		const key = outpointKey(txid, vout);
		const [prevout] = await rpc<Array<{ spendingtxid?: string }>>(
			"gettxspendingprevout",
			[[{ txid, vout }]],
		);
		if (prevout?.spendingtxid) {
			const spender = await getTx(rpc, prevout.spendingtxid);
			remember(
				memo,
				key,
				{ kind: "spender", txid: prevout.spendingtxid },
				opts.memoSize,
			);
			return spentIn(txid, vout, {
				spending_txid: prevout.spendingtxid,
				spending_vin: spender ? inputIndex(spender, txid, vout) : null,
				confirmed: false,
			});
		}

		const known = memo.get(key);
		if (known) {
			const answer = await fromMemo(rpc, txid, vout, known);
			if (answer) return answer;
			memo.delete(key);
		}

		const retryNote =
			"Spent, but no spending transaction was found between the output's block and the tip. The chain may have changed during the lookup; retry.";
		if (!tx.blockhash) {
			return spentIn(txid, vout, {
				spending_txid: null,
				spending_vin: null,
				confirmed: true,
				note: retryNote,
			});
		}

		const tipHash = await rpc<string>("getbestblockhash", []);
		const [tip, funding] = await Promise.all([
			rpc<{ height: number }>("getblockheader", [tipHash, true]),
			rpc<{ height: number }>("getblockheader", [tx.blockhash, true]),
		]);
		const floor = Math.max(funding.height, tip.height - opts.scanBlocks + 1);
		let hash = tipHash;
		for (let height = tip.height; height >= floor; height--) {
			const block = await blockSpends(rpc, hash);
			const hit = block.spends.get(key);
			if (hit) {
				remember(memo, key, { kind: "spender", txid: hit.txid }, opts.memoSize);
				return spentIn(txid, vout, {
					spending_txid: hit.txid,
					spending_vin: hit.vin,
					confirmed: true,
					block_height: height,
					block_hash: hash,
				});
			}
			hash = block.prevHash;
		}

		// Searched every block since the output's own: the chain moved under us.
		if (floor === funding.height) {
			return spentIn(txid, vout, {
				spending_txid: null,
				spending_vin: null,
				confirmed: true,
				note: retryNote,
			});
		}
		remember(
			memo,
			key,
			{ kind: "deeper", tipHeight: tip.height, tipHash },
			opts.memoSize,
		);
		return spentIn(txid, vout, {
			spending_txid: null,
			spending_vin: null,
			confirmed: true,
			note: deeperNote(),
		});
	};
}
