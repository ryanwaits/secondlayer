// MARF hashing primitives + TrieMerkleProof decode/verify.
// Independent port of stacks-core stackslib/src/chainstate/stacks/index/{proofs,bits,node}.rs.
// TrieHasher is sha512/256 everywhere.
import { sha512_256 } from "@noble/hashes/sha2.js";
import {
	type Bytes,
	Reader,
	bytesEqual,
	concat,
	hashAll,
	hex,
} from "./bytes.ts";
import { type NakamotoHeader, blockId } from "./header.ts";

/** MARFValue width: 32-byte value hash + 8 zero bytes. */
export const MARF_VALUE_SIZE = 40;

export const NodeId = {
	Empty: 0,
	Leaf: 1,
	Node4: 2,
	Node16: 3,
	Node48: 4,
	Node256: 5,
} as const;

/** Pointer count per node type id (Node4..Node256). */
export const NODE_PTR_COUNT: Readonly<Record<number, number>> = {
	[NodeId.Node4]: 4,
	[NodeId.Node16]: 16,
	[NodeId.Node48]: 48,
	[NodeId.Node256]: 256,
};

/** Backptr flag on a TriePtr id: child lives in an ancestor block's trie. */
export const isBackptr = (id: number): boolean => (id & 0x80) !== 0;

export interface TriePtr {
	id: number;
	chr: number;
	/** Ancestor block id for backptrs; 32 zero bytes otherwise. */
	backBlock: Bytes;
}

export interface TrieNode {
	id: number;
	path: Bytes;
	ptrs: TriePtr[];
}

/** TrieHash::from_key: sha512/256(utf8(key)). */
export const marfPath = (key: string): Bytes =>
	sha512_256(new TextEncoder().encode(key));

/** MARFValue::from_value: sha512/256(utf8(value)) padded to 40 bytes. */
export function marfValue(value: string): Bytes {
	const v = new Uint8Array(MARF_VALUE_SIZE);
	v.set(sha512_256(new TextEncoder().encode(value)));
	return v;
}

// ---------- hashing (bits.rs) ----------

function pathPreimage(path: Bytes): Bytes {
	if (path.length > 32) throw new Error("trie path longer than 32 bytes");
	return concat([Uint8Array.of(path.length), path]);
}

/** get_leaf_hash: H(Leaf id || path len || path || 40-byte value). */
export const leafHash = (path: Bytes, value: Bytes): Bytes =>
	hashAll([Uint8Array.of(NodeId.Leaf), pathPreimage(path), value]);

/** get_node_hash: H(id || ptrs(id, chr, back_block) || path len || path || child hashes). */
export function nodeHash(node: TrieNode, children: Bytes[]): Bytes {
	const parts: Bytes[] = [Uint8Array.of(node.id)];
	for (const p of node.ptrs)
		parts.push(Uint8Array.of(p.id, p.chr), p.backBlock);
	parts.push(pathPreimage(node.path), ...children);
	return hashAll(parts);
}

// ---------- proof codec ----------

type NodeKind = "Node4" | "Node16" | "Node48" | "Node256";
const PROOF_KIND = [
	"Node4",
	"Node16",
	"Node48",
	"Node256",
	"Leaf",
	"Shunt",
] as const;
const KIND_PTRS: Record<NodeKind, number> = {
	Node4: 4,
	Node16: 16,
	Node48: 48,
	Node256: 256,
};

type NodeStep = {
	kind: NodeKind;
	chr: number;
	node: TrieNode;
	hashes: Bytes[];
};
type LeafStep = { kind: "Leaf"; chr: number; path: Bytes; value: Bytes };
type ShuntStep = { kind: "Shunt"; idx: bigint; hashes: Bytes[] };
type ProofStep = NodeStep | LeafStep | ShuntStep;

/** Decode consensus-serialized TrieMerkleProof<StacksBlockId>. Throws on trailing bytes. */
function decodeProof(bytes: Bytes): ProofStep[] {
	const r = new Reader(bytes);
	const hash = () => r.bytes(32);
	const steps = r.vec((): ProofStep => {
		const kind = PROOF_KIND[r.u8()];
		if (!kind) throw new Error("bad proof step type");
		if (kind === "Shunt")
			return { kind, idx: r.i64(), hashes: r.vec(hash, 1 << 20) };
		const chr = r.u8();
		if (kind === "Leaf")
			return {
				kind,
				chr,
				path: r.bytes(r.u32()),
				value: r.bytes(MARF_VALUE_SIZE),
			};
		const node: TrieNode = {
			id: r.u8(),
			path: r.bytes(r.u32()),
			ptrs: r.vec(
				() => ({ id: r.u8(), chr: r.u8(), backBlock: r.bytes(32) }),
				256,
			),
		};
		const hashes = Array.from({ length: KIND_PTRS[kind] - 1 }, hash);
		return { kind, chr, node, hashes };
	}, 1 << 20);
	if (!r.done) throw new Error("trailing bytes after proof");
	return steps;
}

// ---------- verification (proofs.rs) ----------

const isShunt = (s: ProofStep | undefined): s is ShuntStep =>
	s?.kind === "Shunt";

const segmentEnd = (p: ProofStep[], i: number) => {
	let j = i + 1;
	while (j < p.length && !isShunt(p[j])) j++;
	return j;
};

function segmentProofHash(step: NodeStep, childHash: Bytes): Bytes | null {
	const count = KIND_PTRS[step.kind];
	if (step.node.ptrs.length !== count) return null;
	const all: Bytes[] = [];
	let ih = 0;
	for (const p of step.node.ptrs) {
		if (p.id !== NodeId.Empty && p.chr === step.chr) all.push(childHash);
		else {
			const h = step.hashes[ih++];
			if (!h) return null;
			all.push(h);
		}
	}
	return all.length === count ? nodeHash(step.node, all) : null;
}

function verifySegment(seg: ProofStep[], start: Bytes): Bytes | null {
	let h: Bytes | null = start;
	for (const s of seg) {
		if (s.kind === "Shunt" || !h) return null;
		h = s.kind === "Leaf" ? leafHash(s.path, s.value) : segmentProofHash(s, h);
	}
	return h;
}

function segmentPathPrefix(seg: ProofStep[]): Bytes | null {
	const parts: Bytes[] = [];
	for (const s of seg) {
		if (s.kind === "Shunt") return null;
		// The leaf step's chr is not part of the path (and not hashed): proofs are malleable there.
		if (s.kind === "Leaf") parts.push(s.path);
		else parts.push(Uint8Array.of(s.chr), s.node.path);
	}
	return concat(parts.reverse());
}

function isWellFormed(p: ProofStep[], expectedPath: Bytes): boolean {
	if (p[0]?.kind !== "Leaf") return false;
	let i = 0;
	let path: Bytes = new Uint8Array();
	while (i < p.length) {
		const j = segmentEnd(p, i);
		const prefix = segmentPathPrefix(p.slice(i, j));
		if (!prefix) return false;
		if (i === 0) {
			if (!bytesEqual(prefix, expectedPath)) return false;
			path = prefix;
		} else if (
			prefix.length > path.length ||
			!bytesEqual(path.subarray(0, prefix.length), prefix)
		)
			return false;
		i = j;
		if (i >= p.length) return false; // every segment ends in a shunt proof
		let k = i + 1;
		while (k < p.length && isShunt(p[k])) k++;
		i = k;
	}
	return true;
}

/** next_shunt_hash / junction: `inserted` goes at position idx-1 among `hashes`, after an optional lead. */
function shuntHash(
	lead: Bytes | null,
	idx: bigint,
	inserted: Bytes,
	hashes: Bytes[],
): Bytes | null {
	if (idx === 0n) return null;
	const all: Bytes[] = lead ? [lead] : [];
	let hi = 0;
	for (let i = 0; i < hashes.length + 1; i++) {
		if (idx - 1n === BigInt(i)) all.push(inserted);
		else {
			const h = hashes[hi++];
			if (!h) return null;
			all.push(h);
		}
	}
	return hashAll(all);
}

function verifySteps(
	proof: ProofStep[],
	path: Bytes,
	value: Bytes,
	root: Bytes,
	rootToBlock: Map<string, Bytes>,
): boolean {
	if (!isWellFormed(proof, path)) return false;
	const first = proof[0];
	if (first?.kind !== "Leaf" || !bytesEqual(first.value, value)) return false;

	let i = 0;
	let j = segmentEnd(proof, i);
	const nodeRoot = verifySegment(
		proof.slice(i, j),
		leafHash(first.path, first.value),
	);
	if (!nodeRoot) return false;

	// Shunt proof head: idx must be 0; hashes are the trie's ancestor roots.
	i = j;
	const head = proof[i];
	if (!isShunt(head) || head.idx !== 0n) return false;
	let trieHash =
		head.hashes.length === 0 ? nodeRoot : hashAll([nodeRoot, ...head.hashes]);

	i += 1;
	if (i >= proof.length) return bytesEqual(root, trieHash);
	let backBlock = rootToBlock.get(hex(trieHash));
	if (!backBlock || isShunt(proof[i])) return false;

	while (i < proof.length) {
		j = segmentEnd(proof, i);
		// In the ancestor trie, the backptr child hash is the descendant's block id.
		const nextNodeRoot = verifySegment(proof.slice(i, j), backBlock);
		if (!nextNodeRoot) return false;
		i = j;
		if (i >= proof.length) return false;
		// Tail: consecutive shunts with idx != 0; the last one is the junction.
		j = i;
		while (j < proof.length) {
			const s = proof[j];
			if (!isShunt(s) || s.idx === 0n) break;
			j++;
		}
		j -= 1;
		if (j < i) return false;
		let penultimate = trieHash;
		for (const s of proof.slice(i, j)) {
			if (!isShunt(s)) return false;
			const h = shuntHash(null, s.idx, penultimate, s.hashes);
			if (!h) return false;
			penultimate = h;
		}
		const junction = proof[j];
		if (!isShunt(junction)) return false;
		const next = shuntHash(
			nextNodeRoot,
			junction.idx,
			penultimate,
			junction.hashes,
		);
		if (!next) return false;
		trieHash = next;
		backBlock = rootToBlock.get(hex(trieHash));
		if (!backBlock) return false;
		i = j + 1;
		if (bytesEqual(trieHash, root)) break;
	}
	return bytesEqual(root, trieHash);
}

/**
 * Block ids of the ancestor tries a proof crosses: each one is the backptr a
 * descendant trie follows toward the leaf. `verifyMarfProof` needs every one's
 * header. Read from untrusted proof bytes, so they are only fetch hints; the
 * proof still fails unless each header hashes to the id the trie committed.
 * Malformed proofs yield no ids.
 */
export function marfProofAncestors(proof: Bytes): string[] {
	let steps: ProofStep[];
	try {
		steps = decodeProof(proof);
	} catch {
		return [];
	}
	const ids = new Set<string>();
	for (const s of steps) {
		if (s.kind === "Leaf" || s.kind === "Shunt") continue;
		const ptr = s.node.ptrs.find(
			(p) => p.id !== NodeId.Empty && p.chr === s.chr,
		);
		if (ptr && isBackptr(ptr.id)) ids.add(hex(ptr.backBlock));
	}
	return [...ids];
}

export interface MarfProofInput {
	/** Consensus-serialized TrieMerkleProof (`/v2/clarity/marf/<path>?proof=1`). */
	proof: Bytes;
	/** Leaf path: `marfPath(key)`. */
	path: Bytes;
	/** 40-byte MARFValue: `marfValue(valueString)`. */
	value: Bytes;
	/** Tip state_index_root, from a header the caller authenticated. */
	root: Bytes;
	/**
	 * Tip header plus every ancestor header the proof crosses. Each contributes
	 * state_index_root -> recomputed block id, so ancestor roots are only ever
	 * vouched for by header bytes (a bare root->id map would let a forged
	 * ancestor trie through).
	 */
	headers: NakamotoHeader[];
}

/**
 * TrieMerkleProof::verify. True iff `value` is stored at `path` in the MARF
 * whose tip root is `root`. Inclusion only: MARF proofs cannot prove absence.
 * Malformed proof bytes verify false.
 */
export function verifyMarfProof(input: MarfProofInput): boolean {
	const rootToBlock = new Map<string, Bytes>();
	for (const h of input.headers)
		rootToBlock.set(hex(h.stateIndexRoot), blockId(h));
	try {
		const steps = decodeProof(input.proof);
		return verifySteps(steps, input.path, input.value, input.root, rootToBlock);
	} catch {
		return false;
	}
}
