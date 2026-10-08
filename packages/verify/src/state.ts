// Steps 6-8 of verifyBlock: a block's state witness against its authenticated
// header root, every leaf of its trie named, and indexed rows against the diff.
import { type Bytes, bytesEqual, hex, unhex } from "./bytes.ts";
import { dataVarKey } from "./keys.ts";
import { MARF_VALUE_SIZE, marfPath, marfValue } from "./marf.ts";
import type { StateWrite, VmEventRow } from "./source.ts";
import {
	type WitnessLeaf,
	classifyBlockDiff,
	parseWitness,
} from "./witness.ts";

export interface DiffWrite {
	/** MARF key, when a state_writes row names the leaf. */
	key?: string;
	/** Leaf path, hex. */
	path: string;
	/** sha512/256 of the stored value string, hex. */
	valueHash: string;
	/** Transaction of the last write; null for block-level writes. */
	txIndex?: number | null;
	/** False when the source had no state_writes: the leaf may also be a carried copy. */
	named: boolean;
}

export interface DiffLeaf {
	key?: string;
	path: string;
	valueHash: string;
}

export interface ProvenDiff {
	/** Every leaf is named (state_writes served) and classified. */
	named: boolean;
	writes: DiffWrite[];
	/** Unchanged values copied forward from the parent (proven at the parent). */
	carried: DiffLeaf[];
	/** `__MARF_BLOCK_*` bookkeeping. */
	internal: DiffLeaf[];
}

export type StateFailureCode =
	| "malformed"
	| "root-mismatch"
	| "bad-write"
	| "hidden-write"
	| "missing-write"
	| "key-not-written"
	| "value-mismatch"
	| "bad-row";

export interface StateFailure {
	step: "witness" | "names" | "rows";
	code: StateFailureCode;
	message: string;
	key?: string;
	path?: string;
	ordinal?: number;
}

export interface BlockStateInput {
	/** MARF height of the block (its Stacks chain length). */
	height: number;
	/** Parent block id from the authenticated header. */
	parentBlockId: Bytes;
	/** state_index_root from the authenticated header. */
	stateRoot: Bytes;
	witness: Bytes;
	/** The block's state_writes; null when the source has none (names unavailable). */
	writes: StateWrite[] | null;
	/** Indexed rows to prove against the diff. */
	rows?: VmEventRow[];
	/**
	 * Leaves of the parent's own trie, from a parent witness whose root the
	 * caller checked against the parent header: each is the parent state's
	 * value at its path. Resolves carried leaves without a proof per leaf.
	 */
	parentLeaves?: WitnessLeaf[];
	/**
	 * True iff the leaf's value is stored at its path in the parent's state
	 * (proven by the caller). Asked only with state_writes, for leaves the
	 * parent's own trie does not explain.
	 */
	parentHolds?: (leaf: WitnessLeaf) => Promise<boolean>;
}

export interface BlockStateResult {
	diff?: ProvenDiff;
	rowsChecked: number;
	notes: string[];
	failures: StateFailure[];
}

const INTERNAL = {
	self: "__MARF_BLOCK_HEIGHT_SELF",
	heightToHash: "__MARF_BLOCK_HEIGHT_TO_HASH",
	hashToHeight: "__MARF_BLOCK_HASH_TO_HEIGHT",
} as const;

/** MARFValue of a u32 height: little-endian in the first 4 bytes. */
const heightValue = (h: number): string => {
	const v = new Uint8Array(MARF_VALUE_SIZE);
	new DataView(v.buffer).setUint32(0, h, true);
	return hex(v);
};
/** 40-byte MARFValue hex of a 32-byte hash or block id (zero tail). */
const padded = (b32: Bytes): string => `${hex(b32)}${"00".repeat(8)}`;

/**
 * The `__MARF_BLOCK_*` entries block `height` writes (stacks-core index/marf.rs).
 * The parent's are fixed by the header. The block's own id is not known while
 * its trie is built, so `HEIGHT_TO_HASH::{height}` holds a temporary hash; its
 * value is taken from the witness and must map back to `height`.
 */
function internalEntries(
	height: number,
	parentBlockId: Bytes,
	leaves: WitnessLeaf[],
): [key: string, valueHex: string][] {
	const out: [string, string][] = [[INTERNAL.self, heightValue(height)]];
	const ownKey = `${INTERNAL.heightToHash}::${height}`;
	const ownPath = marfPath(ownKey);
	const own = leaves.find((l) => bytesEqual(l.path, ownPath));
	if (own) {
		out.push([ownKey, padded(own.valueHash)]);
		out.push([
			`${INTERNAL.hashToHeight}::${hex(own.valueHash)}`,
			heightValue(height),
		]);
	}
	if (height > 0) {
		out.push([
			`${INTERNAL.heightToHash}::${height - 1}`,
			padded(parentBlockId),
		]);
		out.push([
			`${INTERNAL.hashToHeight}::${hex(parentBlockId)}`,
			heightValue(height - 1),
		]);
	}
	return out;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const strip0x = (s: string) => (s.startsWith("0x") ? s.slice(2) : s);
const leafHex = (l: WitnessLeaf): DiffLeaf => ({
	path: hex(l.path),
	valueHash: hex(l.valueHash),
});

/** Last write per key, in ordinal order, with its value as the stored string. */
function lastWrites(
	writes: StateWrite[],
	failures: StateFailure[],
): Map<string, { value: string; txIndex: number | null }> {
	const out = new Map<string, { value: string; txIndex: number | null }>();
	for (const w of [...writes].sort((a, b) => a.ordinal - b.ordinal)) {
		try {
			out.set(w.key, {
				value: utf8.decode(unhex(strip0x(w.value_hex))),
				txIndex: w.tx_index,
			});
		} catch {
			failures.push({
				step: "names",
				code: "bad-write",
				message: `state write ${w.ordinal} value is not UTF-8 hex`,
				key: w.key,
				ordinal: w.ordinal,
			});
		}
	}
	return out;
}

/** The MARF key and stored value string a vm_events row writes (mirrors clarity_db.rs). */
function rowWrite(row: VmEventRow): [key: string, value: string] {
	const need = (v: string | null | undefined, name: string): string => {
		if (!v) throw new Error(`${row.event_type} row has no ${name}`);
		return v;
	};
	if (row.event_type === "var_set")
		return [
			dataVarKey(row.contract_id, need(row.var_name, "var_name")),
			strip0x(need(row.raw_value, "raw_value")).toLowerCase(),
		];
	const key = `vm::${row.contract_id}::0::${need(row.map, "map")}::${strip0x(need(row.raw_key, "raw_key")).toLowerCase()}`;
	if (row.event_type === "map_delete") return [key, "09"];
	// put_value stores map entries as (some value).
	return [key, `0a${strip0x(need(row.raw_value, "raw_value")).toLowerCase()}`];
}

/**
 * Rows against the block's leaves: every row's key must be a leaf, and the
 * last row per key must carry the leaf's value.
 */
function checkRows(
	rows: VmEventRow[],
	leaves: WitnessLeaf[],
	failures: StateFailure[],
): number {
	const byPath = new Map(leaves.map((l) => [hex(l.path), l]));
	const named: { row: VmEventRow; key: string; path: string; value: string }[] =
		[];
	for (const row of [...rows].sort((a, b) => a.event_index - b.event_index)) {
		try {
			const [key, value] = rowWrite(row);
			named.push({ row, key, path: hex(marfPath(key)), value });
		} catch (err) {
			failures.push({
				step: "rows",
				code: "bad-row",
				message: (err as Error).message,
				ordinal: row.event_index,
			});
		}
	}
	const last = new Map(named.map((n, i) => [n.path, i]));
	named.forEach((n, i) => {
		const leaf = byPath.get(n.path);
		const at = { key: n.key, path: n.path, ordinal: n.row.event_index };
		if (!leaf)
			failures.push({
				step: "rows",
				code: "key-not-written",
				message: `${n.row.event_type} row ${n.row.event_index} names a key the block did not write`,
				...at,
			});
		else if (
			last.get(n.path) === i &&
			padded(leaf.valueHash) !== hex(marfValue(n.value))
		)
			failures.push({
				step: "rows",
				code: "value-mismatch",
				message: `${n.row.event_type} row ${n.row.event_index} value differs from the block's leaf`,
				...at,
			});
	});
	return named.length;
}

/**
 * Verify block state against an authenticated header: the witness must
 * recompute `stateRoot`, then every leaf is classified. With state_writes,
 * any leaf that is not a named write, a carried parent value or MARF
 * bookkeeping is a hidden write. Without them the diff is still proven
 * (every leaf is in the block): carried leaves are told apart only through
 * `parentLeaves`, and the remaining writes come back unnamed.
 */
export async function verifyBlockState(
	input: BlockStateInput,
): Promise<BlockStateResult> {
	const out: BlockStateResult = { rowsChecked: 0, notes: [], failures: [] };
	let witness: ReturnType<typeof parseWitness>;
	try {
		witness = parseWitness(input.witness);
	} catch (err) {
		out.failures.push({
			step: "witness",
			code: "malformed",
			message: (err as Error).message,
		});
		return out;
	}
	if (!bytesEqual(witness.root, input.stateRoot)) {
		out.failures.push({
			step: "witness",
			code: "root-mismatch",
			message: `witness root ${hex(witness.root)} != header state_index_root ${hex(input.stateRoot)}`,
		});
		return out;
	}
	const { leaves } = witness;
	const internal = internalEntries(input.height, input.parentBlockId, leaves);
	const named = input.writes !== null;
	const last = lastWrites(input.writes ?? [], out.failures);
	const writes = [...last].map(([k, w]): [string, string] => [k, w.value]);
	// First pass with no parent values finds the leaves that need one.
	const first = classifyBlockDiff({
		leaves,
		writes,
		internal,
		parentValue: () => undefined,
	});
	const inParent = new Map(
		(input.parentLeaves ?? []).map((l) => [hex(l.path), hex(l.valueHash)]),
	);
	const carried = new Map<string, string>();
	for (const leaf of first.hidden) {
		const pathHex = hex(leaf.path);
		if (
			inParent.get(pathHex) === hex(leaf.valueHash) ||
			(named && (await input.parentHolds?.(leaf)))
		)
			carried.set(pathHex, padded(leaf.valueHash));
	}
	const d = classifyBlockDiff({
		leaves,
		writes,
		internal,
		parentValue: (p) => carried.get(p),
	});
	out.diff = {
		named,
		writes: named
			? d.writes.map((l) => ({
					...leafHex(l),
					key: l.key,
					txIndex: last.get(l.key)?.txIndex ?? null,
					named: true,
				}))
			: // Without names every unexplained leaf is a write we cannot label.
				d.hidden.map((l) => ({ ...leafHex(l), named: false })),
		carried: d.carried.map(leafHex),
		internal: d.internal.map((l) => ({ ...leafHex(l), key: l.key })),
	};
	if (!named)
		out.notes.push(
			`source has no state_writes for block ${input.height}: ${d.hidden.length} written leaves are proven in the block but unnamed`,
		);
	else {
		for (const l of d.hidden)
			out.failures.push({
				step: "names",
				code: "hidden-write",
				message: `leaf ${hex(l.path)} is not a named write, a carried parent value or MARF bookkeeping`,
				path: hex(l.path),
			});
		for (const key of d.missing)
			out.failures.push({
				step: "names",
				code: "missing-write",
				message: `state write ${key} has no leaf holding its value`,
				key,
				path: hex(marfPath(key)),
			});
	}
	if (input.rows) out.rowsChecked = checkRows(input.rows, leaves, out.failures);
	return out;
}
