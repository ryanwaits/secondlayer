// Ported from ord 0.29.0 `crates/ordinals/src/rune_id.rs`.
// RuneId.block is u64, RuneId.tx is u32 in ord; both kept as bigint here
// (u128 = bigint everywhere) with range checks matching the Rust try_into calls.

export interface RuneId {
	block: bigint;
	tx: bigint;
}

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = (1n << 32n) - 1n;

export function runeIdDefault(): RuneId {
	return { block: 0n, tx: 0n };
}

export function runeIdNew(block: bigint, tx: bigint): RuneId | undefined {
	if (block < 0n || block > U64_MAX) return undefined;
	if (tx < 0n || tx > U32_MAX) return undefined;
	if (block === 0n && tx > 0n) return undefined;
	return { block, tx };
}

/** `next` — `block`/`tx` here are u128 deltas straight off the wire (edict integers). */
export function runeIdNext(
	self: RuneId,
	block: bigint,
	tx: bigint,
): RuneId | undefined {
	if (block < 0n || block > U64_MAX) return undefined; // block.try_into::<u64>()
	const newBlock = self.block + block;
	if (newBlock > U64_MAX) return undefined; // checked_add overflow

	let newTx: bigint;
	if (block === 0n) {
		if (tx < 0n || tx > U32_MAX) return undefined; // tx.try_into::<u32>()
		newTx = self.tx + tx;
		if (newTx > U32_MAX) return undefined; // checked_add overflow
	} else {
		if (tx < 0n || tx > U32_MAX) return undefined; // tx.try_into::<u32>()
		newTx = tx;
	}

	return runeIdNew(newBlock, newTx);
}

export function runeIdDelta(
	self: RuneId,
	next: RuneId,
): [bigint, bigint] | undefined {
	if (next.block < self.block) return undefined; // checked_sub
	const block = next.block - self.block;
	let tx: bigint;
	if (block === 0n) {
		if (next.tx < self.tx) return undefined; // checked_sub
		tx = next.tx - self.tx;
	} else {
		tx = next.tx;
	}
	return [block, tx];
}

export function runeIdToString(id: RuneId): string {
	return `${id.block}:${id.tx}`;
}

export class RuneIdParseError extends Error {
	constructor(
		readonly kind: "separator" | "block" | "transaction",
		message: string,
	) {
		super(message);
		this.name = "RuneIdParseError";
	}
}

export function runeIdFromString(s: string): RuneId {
	const sep = s.indexOf(":");
	if (sep === -1) {
		throw new RuneIdParseError("separator", "missing separator");
	}
	const heightStr = s.slice(0, sep);
	const indexStr = s.slice(sep + 1);
	if (!/^\d+$/.test(heightStr)) {
		throw new RuneIdParseError("block", `invalid height: ${heightStr}`);
	}
	if (!/^\d+$/.test(indexStr)) {
		throw new RuneIdParseError("transaction", `invalid index: ${indexStr}`);
	}
	const block = BigInt(heightStr);
	const tx = BigInt(indexStr);
	if (block > U64_MAX) {
		throw new RuneIdParseError("block", `invalid height: ${heightStr}`);
	}
	if (tx > U32_MAX) {
		throw new RuneIdParseError("transaction", `invalid index: ${indexStr}`);
	}
	return { block, tx };
}

/** Sort key matching ord's `#[derive(Ord, PartialOrd)]` (block first, then tx). */
export function runeIdCompare(a: RuneId, b: RuneId): number {
	if (a.block !== b.block) return a.block < b.block ? -1 : 1;
	if (a.tx !== b.tx) return a.tx < b.tx ? -1 : 1;
	return 0;
}
