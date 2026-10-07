// State witness v2: every node local to block N's trie, enough to recompute
// N's state_index_root and enumerate every leaf trie N holds.
//
//   v2    := 0x02 | u16 n_anc | [32]*n_anc ancestor roots | u16 n_tbl | [32]*n_tbl ancestor block ids | node
//   node  := u8 id | u8 plen | path | u16 n_ptrs | ptr* | child*   (one child per local ptr, in order)
//   ptr   := u8 id | (id != 0: u8 chr) | (backptr: u16 tbl_idx)    (empty ptr = 0x00, chr 0)
//   leaf  := 0x01 | u8 plen | path | [32] value hash
//
// Hashing mirrors stacks-core storage.rs: a backptr child contributes the
// ancestor BLOCK ID, an empty child TrieHash::EMPTY, and the root is
// sha512/256(node_root || ancestor roots) unless there are no ancestors.
import {
	type Bytes,
	Reader,
	bytesEqual,
	hashAll,
	hex,
	unhex,
} from "./bytes.ts";
import {
	MARF_VALUE_SIZE,
	NODE_PTR_COUNT,
	NodeId,
	type TriePtr,
	isBackptr,
	leafHash,
	marfPath,
	marfValue,
	nodeHash,
} from "./marf.ts";

const WITNESS_VERSION = 2;
const PATH_LEN = 32;
/** stacks-common TrieHash::EMPTY = sha512/256 of the empty string. */
export const TRIE_HASH_EMPTY = unhex(
	"c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a",
);
const ZERO_BLOCK = new Uint8Array(32);

export interface WitnessLeaf {
	/** Full 32-byte trie path: `marfPath(key)`. */
	path: Bytes;
	/** 32-byte value hash (first 32 bytes of the MARFValue; the tail is zero). */
	valueHash: Bytes;
}

export interface StateWitness {
	/** Recomputed trie root; compare to the authenticated header's state_index_root. */
	root: Bytes;
	/** Skip-list ancestor trie roots folded into `root`. */
	ancestorRoots: Bytes[];
	leaves: WitnessLeaf[];
	nodes: number;
}

/**
 * Parse a v2 state witness and recompute its root. Throws on malformed input.
 * The result proves nothing until `root` equals a header's state_index_root.
 */
export function parseWitness(bytes: Bytes): StateWitness {
	const r = new Reader(bytes);
	const version = r.u8();
	if (version !== WITNESS_VERSION)
		throw new Error(`unsupported witness version ${version}`);
	const ancestorRoots = Array.from({ length: r.u16() }, () => r.bytes(32));
	const blockTable = Array.from({ length: r.u16() }, () => r.bytes(32));
	const leaves: WitnessLeaf[] = [];
	const seen = new Set<string>();
	let nodes = 0;

	const readNode = (prefix: number[], expectedId: number | null): Bytes => {
		nodes++;
		const id = r.u8();
		if (expectedId !== null && id !== expectedId)
			throw new Error(
				`child id ${id} does not match its pointer id ${expectedId}`,
			);
		const path = r.bytes(r.u8());
		const depth = prefix.length + path.length;
		if (id === NodeId.Leaf) {
			if (depth !== PATH_LEN)
				throw new Error("leaf path does not complete 32 bytes");
			const valueHash = r.bytes(32);
			const full = Uint8Array.from([...prefix, ...path]);
			const key = hex(full);
			if (seen.has(key)) throw new Error(`duplicate leaf ${key}`);
			seen.add(key);
			leaves.push({ path: full, valueHash });
			return leafHash(path, padValue(valueHash));
		}
		const count = NODE_PTR_COUNT[id];
		if (count === undefined) throw new Error(`bad node id ${id}`);
		if (depth >= PATH_LEN) throw new Error("interior node at full path depth");
		const n = r.u16();
		if (n !== count)
			throw new Error(`node id ${id} has ${n} ptrs, expected ${count}`);
		const ptrs: TriePtr[] = [];
		for (let i = 0; i < n; i++) {
			const pid = r.u8();
			if (pid === NodeId.Empty) {
				ptrs.push({ id: pid, chr: 0, backBlock: ZERO_BLOCK });
				continue;
			}
			const chr = r.u8();
			if (!isBackptr(pid)) {
				ptrs.push({ id: pid, chr, backBlock: ZERO_BLOCK });
				continue;
			}
			const block = blockTable[r.u16()];
			if (!block) throw new Error("backptr table index out of range");
			ptrs.push({ id: pid, chr, backBlock: block });
		}
		const childPrefix = [...prefix, ...path];
		const children = ptrs.map((p) => {
			if (p.id === NodeId.Empty) return TRIE_HASH_EMPTY;
			if (isBackptr(p.id)) return p.backBlock;
			return readNode([...childPrefix, p.chr], p.id);
		});
		return nodeHash({ id, path, ptrs }, children);
	};

	const nodeRoot = readNode([], null);
	if (!r.done) throw new Error("trailing bytes after witness");
	const root =
		ancestorRoots.length === 0
			? nodeRoot
			: hashAll([nodeRoot, ...ancestorRoots]);
	return { root, ancestorRoots, leaves, nodes };
}

const padValue = (valueHash: Bytes): Bytes => {
	const v = new Uint8Array(MARF_VALUE_SIZE);
	v.set(valueHash);
	return v;
};

/** Leaf value equals a full 40-byte MARFValue (hash head, zero tail). */
const leafHolds = (leaf: WitnessLeaf, value: Bytes): boolean =>
	value.length === MARF_VALUE_SIZE &&
	bytesEqual(padValue(leaf.valueHash), value);

export interface BlockDiffInput {
	/** `parseWitness(bytes).leaves`, from a witness whose root was checked. */
	leaves: WitnessLeaf[];
	/** Claimed writes of the block: [key, value string] as stored by Clarity. */
	writes: [key: string, value: string][];
	/** MARF bookkeeping keys (`__MARF_*`) with their raw 40-byte MARFValue hex, derived from the header chain. */
	internal: [key: string, valueHex: string][];
	/** Value at `pathHex` in the PARENT block's state (40-byte MARFValue hex), already proven by the caller. */
	parentValue: (pathHex: string) => string | undefined;
}

export interface ClassifiedLeaf extends WitnessLeaf {
	key: string;
}

export interface BlockDiff {
	/** Leaves matching a claimed write (path and value). */
	writes: ClassifiedLeaf[];
	/** Unclaimed leaves holding the parent's value: copied forward, not written. */
	carried: WitnessLeaf[];
	/** Leaves matching a `__MARF_*` bookkeeping entry. */
	internal: ClassifiedLeaf[];
	/** Leaves nothing explains: an unreported write. Non-empty = reject. */
	hidden: WitnessLeaf[];
	/** Claimed write keys with no leaf holding the claimed value. Non-empty = reject. */
	missing: string[];
	/** No hidden leaves and no missing writes: the claimed writes are the block's complete diff. */
	complete: boolean;
}

const INTERNAL_PREFIX = "__MARF_";

/**
 * Classify every leaf of block N's trie against the claimed write set.
 * Each leaf must be a claimed write, a carried (unchanged) parent value, or a
 * MARF-internal key; anything else is a hidden write.
 */
export function classifyBlockDiff(input: BlockDiffInput): BlockDiff {
	const writes = indexClaims(input.writes, (v) => marfValue(v));
	const internal = indexClaims(input.internal, (v) => {
		const value = unhex(v);
		if (value.length !== MARF_VALUE_SIZE)
			throw new Error(`internal value must be ${MARF_VALUE_SIZE} bytes`);
		return value;
	});
	for (const { key } of internal.values())
		if (!key.startsWith(INTERNAL_PREFIX))
			throw new Error(
				`internal key must start with ${INTERNAL_PREFIX}: ${key}`,
			);

	const out: BlockDiff = {
		writes: [],
		carried: [],
		internal: [],
		hidden: [],
		missing: [],
		complete: false,
	};
	const matched = new Set<string>();
	for (const leaf of input.leaves) {
		const pathHex = hex(leaf.path);
		const write = writes.get(pathHex);
		if (write && leafHolds(leaf, write.value)) {
			out.writes.push({ ...leaf, key: write.key });
			matched.add(pathHex);
			continue;
		}
		const bookkeeping = internal.get(pathHex);
		if (bookkeeping && leafHolds(leaf, bookkeeping.value)) {
			out.internal.push({ ...leaf, key: bookkeeping.key });
			continue;
		}
		const parent = write ? undefined : input.parentValue(pathHex);
		if (parent !== undefined && leafHolds(leaf, unhex(parent)))
			out.carried.push(leaf);
		else out.hidden.push(leaf);
	}
	for (const [pathHex, { key }] of writes)
		if (!matched.has(pathHex)) out.missing.push(key);
	out.complete = out.hidden.length === 0 && out.missing.length === 0;
	return out;
}

function indexClaims(
	claims: [string, string][],
	toValue: (v: string) => Bytes,
): Map<string, { key: string; value: Bytes }> {
	const byPath = new Map<string, { key: string; value: Bytes }>();
	for (const [key, value] of claims) {
		const pathHex = hex(marfPath(key));
		if (byPath.has(pathHex)) throw new Error(`duplicate claimed key ${key}`);
		byPath.set(pathHex, { key, value: toValue(value) });
	}
	return byPath;
}
