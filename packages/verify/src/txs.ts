// A Nakamoto block's transactions against its header's tx_merkle_root
// (stacks-common util/hash.rs MerkleTree, MerkleHashFunc = Sha512Trunc256Sum).
import { sha512_256 } from "@noble/hashes/sha2.js";
import { splitTransactions } from "@secondlayer/stacks/transactions";
import { type Bytes, bytesEqual, concat, hex } from "./bytes.ts";
import type { NakamotoHeader } from "./header.ts";

export interface BlockTransaction {
	/** sha512/256 of the transaction bytes, hex. */
	txid: string;
	/** The consensus-serialized transaction. */
	raw: Bytes;
}

const LEAF_TAG = new Uint8Array([0x00]);
const NODE_TAG = new Uint8Array([0x01]);

/**
 * tx_merkle_root over txids: leaf = H(0x00 ‖ txid), node = H(0x01 ‖ l ‖ r),
 * an odd level duplicates its last node, and a lone leaf is still paired with
 * itself (one-tx blocks hash H(0x01 ‖ leaf ‖ leaf)).
 */
export function txMerkleRoot(txids: Bytes[]): Bytes {
	if (txids.length === 0) throw new Error("no transactions");
	let level = txids.map((t) => sha512_256(concat([LEAF_TAG, t])));
	do {
		if (level.length % 2 === 1) level.push(level[level.length - 1] as Bytes);
		const next: Bytes[] = [];
		for (let i = 0; i < level.length; i += 2) {
			next.push(
				sha512_256(
					concat([NODE_TAG, level[i] as Bytes, level[i + 1] as Bytes]),
				),
			);
		}
		level = next;
	} while (level.length > 1);
	return level[0] as Bytes;
}

export class TransactionsError extends Error {
	constructor(
		readonly code: "malformed" | "tx-root-mismatch",
		message: string,
	) {
		super(message);
	}
}

/**
 * The block's transactions, each hashed to its txid, checked against the
 * header's tx_merkle_root. The body after `header.byteLength` is a u32 count
 * then the transactions back to back. Null when the bytes are the header
 * alone (a source that serves headers only): nothing to check. Throws
 * {@link TransactionsError} on a malformed body, trailing bytes or a root
 * mismatch.
 */
export function blockTransactions(
	raw: Bytes,
	header: NakamotoHeader,
): BlockTransaction[] | null {
	const body = raw.subarray(header.byteLength);
	if (body.length === 0) return null;
	if (body.length < 4)
		throw new TransactionsError("malformed", "block body has no tx count");
	const count = new DataView(
		body.buffer,
		body.byteOffset,
		body.byteLength,
	).getUint32(0);
	if (count === 0)
		throw new TransactionsError("malformed", "block has no transactions");
	let txs: Bytes[];
	try {
		txs = splitTransactions(body.subarray(4), count);
	} catch (err) {
		throw new TransactionsError(
			"malformed",
			`transactions do not parse: ${(err as Error).message}`,
		);
	}
	const used = txs.reduce((n, t) => n + t.length, 4);
	if (used !== body.length)
		throw new TransactionsError(
			"malformed",
			`${body.length - used} bytes after the block's ${count} transactions`,
		);
	const ids = txs.map((t) => sha512_256(t));
	const root = txMerkleRoot(ids);
	if (!bytesEqual(root, header.txMerkleRoot))
		throw new TransactionsError(
			"tx-root-mismatch",
			`transactions hash to ${hex(root)}, header tx_merkle_root is ${hex(header.txMerkleRoot)}`,
		);
	return txs.map((t, i) => ({ txid: hex(ids[i] as Bytes), raw: t }));
}
