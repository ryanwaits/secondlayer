// Builds a two-trie TrieMerkleProof of `__MARF_BLOCK_HEIGHT_TO_HASH::<height>`
// over real header bytes. No source serves proofs of `__MARF_*` keys yet (the
// node's `/v2/clarity/marf` needs a stored value string, and these have none),
// so the shape is reproduced from stacks-core proofs.rs instead: the leaf sits
// in an ancestor trie A; the tip trie T reaches it through a backptr whose
// child hash is A's block id, and T's root folds in A's root (A is T's
// skip-list ancestor at distance 1, so the junction shunt has idx 1).
import { concat, hashAll } from "../src/bytes.ts";
import {
	type Bytes,
	type Epoch2Header,
	type NakamotoHeader,
	blockId,
	hex,
	marfPath,
	parseEpoch2Header,
	parseNakamotoHeader,
	unhex,
} from "../src/index.ts";
import { NodeId, heightToHashKey, leafHash, nodeHash } from "../src/marf.ts";
import { TRIE_HASH_EMPTY } from "../src/witness.ts";

/** Byte offset of state_index_root in a Nakamoto header. */
const NAKAMOTO_ROOT_AT = 1 + 8 + 8 + 20 + 32 + 32;
/** Byte offset of state_index_root in an epoch 2.x header. */
const EPOCH2_ROOT_AT = 1 + 16 + 80 + 32 + 32 + 2 + 32;
const ZERO32 = new Uint8Array(32);
const BACKPTR = 0x80;
const STEP = { Node4: 0, Leaf: 4, Shunt: 5 } as const;

const u32 = (n: number) => {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n);
	return b;
};
const i64 = (n: number) => {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigInt64(0, BigInt(n));
	return b;
};

/** A root Node4 with one child at `chr` and three empty pointers. */
function node4(chr: number, childId: number, backBlock: Bytes) {
	const ptrs = [
		{ id: childId, chr, backBlock },
		...Array.from({ length: 3 }, () => ({
			id: NodeId.Empty,
			chr: 0,
			backBlock: ZERO32,
		})),
	];
	return { id: NodeId.Node4, path: new Uint8Array(), ptrs };
}

const encodeNode = (n: ReturnType<typeof node4>) =>
	concat([
		Uint8Array.of(n.id),
		u32(n.path.length),
		n.path,
		u32(n.ptrs.length),
		...n.ptrs.map((p) => concat([Uint8Array.of(p.id, p.chr), p.backBlock])),
	]);

const withRoot = (raw: Bytes, at: number, root: Bytes): Bytes => {
	const out = raw.slice();
	out.set(root, at);
	return out;
};

export interface HeightProof {
	proof: Bytes;
	/** Tip header (checkpoint bytes with T's root): what the proof is checked against. */
	tip: Bytes;
	tipHeader: NakamotoHeader;
	/** Ancestor trie A's header, epoch 2.x, as a source would serve it. */
	ancestor: { header: Bytes; consensusHash: Bytes };
	ancestorHeader: Epoch2Header;
	ancestorId: string;
}

/**
 * Prove that `id` is stored at `__MARF_BLOCK_HEIGHT_TO_HASH::<height>` in a
 * tip built from `tipBytes` (a Nakamoto header), through an ancestor trie
 * whose header is `ancestorBytes` (epoch 2.x) with `ancestorCh`.
 */
export function buildHeightProof(opts: {
	height: number;
	id: string;
	tipBytes: Bytes;
	ancestorBytes: Bytes;
	ancestorCh: Bytes;
}): HeightProof {
	const path = marfPath(heightToHashKey(opts.height));
	const chr = path[0] as number;
	const value = new Uint8Array(40);
	value.set(unhex(opts.id));
	const empty = Array.from({ length: 3 }, () => TRIE_HASH_EMPTY);

	// Trie A: root Node4 -> leaf (path[1..]).
	const leafPath = path.subarray(1);
	const nodeA = node4(chr, NodeId.Leaf, ZERO32);
	const nodeRootA = nodeHash(nodeA, [leafHash(leafPath, value), ...empty]);
	const prevRoot = hashAll([Uint8Array.of(7)]); // A's own skip-list ancestor
	const rootA = hashAll([nodeRootA, prevRoot]);
	const ancestorRaw = withRoot(opts.ancestorBytes, EPOCH2_ROOT_AT, rootA);
	const ancestorHeader = parseEpoch2Header(ancestorRaw, opts.ancestorCh);
	const idA = blockId(ancestorHeader);

	// Trie T: root Node4 -> backptr to A's leaf; T's root folds in A's root.
	const nodeT = node4(chr, NodeId.Leaf | BACKPTR, idA);
	const nodeRootT = nodeHash(nodeT, [idA, ...empty]);
	const rootT = hashAll([nodeRootT, rootA]);
	const tip = withRoot(opts.tipBytes, NAKAMOTO_ROOT_AT, rootT);

	const steps = [
		concat([
			Uint8Array.of(STEP.Leaf, chr),
			u32(leafPath.length),
			leafPath,
			value,
		]),
		concat([Uint8Array.of(STEP.Node4, chr), encodeNode(nodeA), ...empty]),
		concat([Uint8Array.of(STEP.Shunt), i64(0), u32(1), prevRoot]),
		concat([Uint8Array.of(STEP.Node4, chr), encodeNode(nodeT), ...empty]),
		concat([Uint8Array.of(STEP.Shunt), i64(1), u32(0)]),
	];
	return {
		proof: concat([u32(steps.length), ...steps]),
		tip,
		tipHeader: parseNakamotoHeader(tip),
		ancestor: {
			header: ancestorRaw.subarray(0, 247),
			consensusHash: opts.ancestorCh,
		},
		ancestorHeader,
		ancestorId: hex(idA),
	};
}
