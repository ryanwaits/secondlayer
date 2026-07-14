// f071 Stage 2a — the worker-side "ctx membrane" core: a verbatim port of
// `context.ts`'s write-op construction (`insert`/`update`/`upsert`/
// `increment`/`delete`, :125-245) and its pending-ops overlay
// (`overlayOne`/`overlayMany`/`applyOpToRow`, :339-446, plus the small
// helpers `stripControlKeys`/`valEq`/`rowMatches`/`toBigIntOr0`/
// `validateColumnName`, :57-61 and :978-1013).
//
// WHY DUPLICATED RATHER THAN IMPORTED: this logic is pure data
// transformation — no I/O, no secrets, no DB handle — so the design doc
// explicitly calls duplicating it into the worker side safe and correct
// ("a real port should port that logic verbatim … it is pure data
// transformation with no I/O and no secrets, so it's safe to duplicate into
// the worker bundle unchanged", spike doc §2.2/§7). It is NOT imported from
// `context.ts` because that module also carries the live-transaction flush
// path (`sql.raw(...).execute(this.db)`) that must never be reachable from
// inside a sandboxed worker, even indirectly — importing only the pure
// half would require restructuring `context.ts` itself, which is out of
// scope for this plan (context.ts is not in the touched-files list; the
// in-process path must stay byte-for-byte as the flag-off parity oracle).
//
// CORRECTNESS CONTRACT this file exists to uphold: every function below
// must produce IDENTICAL output to the corresponding `context.ts` logic for
// the same inputs. `overlay-parity.test.ts` asserts this directly against a
// real `SubgraphContext` over the full write×read matrix — treat any
// divergence found there as a hard stop (per the plan's STOP conditions),
// not something to reconcile by changing the test.
import type { SubgraphSchema } from "../../types.ts";

export interface WriteOp {
	kind: "insert" | "update" | "delete" | "increment";
	table: string;
	data: Record<string, unknown>;
	/** For update: SET clause. For increment: column → signed delta. */
	set?: Record<string, unknown>;
}

export interface OpMeta {
	blockHeight: number;
	txId: string;
}

/** Mirrors `context.ts:56-61`. */
export function validateColumnName(name: string): void {
	if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
		throw new Error(`Invalid column name: ${name}`);
	}
}

// ── Write-op construction — mirrors context.ts:125-245 exactly ──

/** Mirrors `SubgraphContext.insert`, context.ts:125-132. */
export function buildInsertOp(
	table: string,
	row: Record<string, unknown>,
	meta: OpMeta,
): WriteOp {
	return {
		kind: "insert",
		table,
		data: { ...row, _block_height: meta.blockHeight, _tx_id: meta.txId },
	};
}

/** Mirrors `SubgraphContext.update`, context.ts:134-141. */
export function buildUpdateOp(
	table: string,
	where: Record<string, unknown>,
	set: Record<string, unknown>,
): WriteOp {
	return { kind: "update", table, data: where, set };
}

/**
 * Mirrors `SubgraphContext.upsert`, context.ts:143-190. The production
 * fallback path (`hasUniqueConstraint` false) also calls `logger.warn(...)`
 * — dropped here since worker-side code has no I/O and the warning is
 * diagnostic-only, not correctness-bearing; the resulting `WriteOp` shape
 * (the part that matters for overlay + eventual host replay) is identical
 * either way.
 */
export function buildUpsertOp(
	table: string,
	key: Record<string, unknown>,
	row: Record<string, unknown>,
	schema: SubgraphSchema,
	meta: OpMeta,
): WriteOp | undefined {
	const tableDef = schema[table];
	if (!tableDef) return undefined;
	const keyColumns = Object.keys(key);

	const hasUniqueConstraint = tableDef.uniqueKeys?.some(
		(uk) =>
			uk.length === keyColumns.length &&
			uk.every((c) => keyColumns.includes(c)),
	);

	const opMeta = { _block_height: meta.blockHeight, _tx_id: meta.txId };

	if (hasUniqueConstraint) {
		return {
			kind: "insert",
			table,
			data: { ...key, ...row, ...opMeta, _upsert_keys: keyColumns },
		};
	}
	return {
		kind: "insert",
		table,
		data: {
			...key,
			...row,
			...opMeta,
			_upsert_fallback_keys: keyColumns,
			_upsert_fallback_set: row,
		},
	};
}

/** Mirrors `SubgraphContext.increment`, context.ts:197-245 (including its
 *  validation — same error messages, same throw conditions). */
export function buildIncrementOp(
	table: string,
	key: Record<string, unknown>,
	deltas: Record<string, bigint | number>,
	schema: SubgraphSchema,
	meta: OpMeta,
): WriteOp {
	const tableDef = schema[table];
	const keyColumns = Object.keys(key);
	const hasUniqueConstraint = tableDef?.uniqueKeys?.some(
		(uk) =>
			uk.length === keyColumns.length &&
			uk.every((c) => keyColumns.includes(c)),
	);
	if (!hasUniqueConstraint) {
		throw new Error(
			`increment("${table}") requires a uniqueKeys constraint on [${keyColumns.join(", ")}]`,
		);
	}
	for (const [col, v] of Object.entries(deltas)) {
		validateColumnName(col);
		if (keyColumns.includes(col)) {
			throw new Error(`increment("${table}"): "${col}" is a key column`);
		}
		if (typeof v !== "bigint" && typeof v !== "number") {
			throw new Error(
				`increment("${table}"): delta for "${col}" must be bigint or number`,
			);
		}
	}
	return {
		kind: "increment",
		table,
		data: {
			...key,
			_block_height: meta.blockHeight,
			_tx_id: meta.txId,
			_upsert_keys: keyColumns,
		},
		set: { ...deltas },
	};
}

/** Mirrors `SubgraphContext.delete`, context.ts:192-195. */
export function buildDeleteOp(
	table: string,
	where: Record<string, unknown>,
): WriteOp {
	return { kind: "delete", table, data: where };
}

// ── Pending-ops overlay (read-your-writes) — mirrors context.ts:330-446 ──

/** Mirrors `context.ts:339-351`. */
export function overlayOne(
	ops: readonly WriteOp[],
	table: string,
	where: Record<string, unknown>,
	dbRow: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (ops.length === 0) return dbRow;
	let row = dbRow;
	for (const op of ops) {
		if (op.table !== table) continue;
		row = applyOpToRow(op, row, where);
	}
	return row;
}

/** Mirrors `context.ts:353-391`. */
export function overlayMany(
	ops: readonly WriteOp[],
	table: string,
	where: Record<string, unknown>,
	dbRows: Record<string, unknown>[],
): Record<string, unknown>[] {
	if (ops.length === 0) return [...dbRows];
	let result = [...dbRows];
	for (const op of ops) {
		if (op.table !== table) continue;
		if (op.kind === "update") {
			for (let i = 0; i < result.length; i++) {
				// biome-ignore lint/style/noNonNullAssertion: idx bounds-checked by loop condition
				if (rowMatches(result[i]!, op.data))
					result[i] = { ...result[i], ...(op.set ?? {}) };
			}
		} else if (op.kind === "delete") {
			result = result.filter((r) => !rowMatches(r, op.data));
		} else {
			// insert / increment — merge into the keyed row, or append if the
			// new row satisfies the filter.
			const upsertKeys = op.data._upsert_keys as string[] | undefined;
			const clean = stripControlKeys(op.data);
			const idx = upsertKeys
				? result.findIndex((r) =>
						upsertKeys.every((k) => valEq(r[k], clean[k])),
					)
				: -1;
			if (idx >= 0) {
				// biome-ignore lint/style/noNonNullAssertion: idx bounds-checked above
				const existing = result[idx]!;
				result[idx] = applyOpToRow(op, existing, where) ?? existing;
			} else {
				const created = applyOpToRow(op, null, where);
				if (created) result.push(created);
			}
		}
	}
	return result;
}

/** Mirrors `context.ts:393-446`. */
export function applyOpToRow(
	op: WriteOp,
	row: Record<string, unknown> | null,
	where: Record<string, unknown>,
): Record<string, unknown> | null {
	const upsertKeys = op.data._upsert_keys as string[] | undefined;
	const clean = stripControlKeys(op.data);

	switch (op.kind) {
		case "insert": {
			if (row) {
				if (upsertKeys?.every((k) => valEq(row[k], clean[k]))) {
					const merged = { ...row };
					for (const [k, v] of Object.entries(clean)) {
						if (!upsertKeys.includes(k) && !k.startsWith("_")) merged[k] = v;
					}
					return merged;
				}
				return row;
			}
			return rowMatches(clean, where) ? { ...clean } : null;
		}
		case "increment": {
			const deltas = op.set ?? {};
			if (row) {
				// biome-ignore lint/style/noNonNullAssertion: increment always carries _upsert_keys
				if (upsertKeys!.every((k) => valEq(row[k], clean[k]))) {
					const merged = { ...row };
					for (const [col, d] of Object.entries(deltas)) {
						merged[col] = toBigIntOr0(merged[col]) + toBigIntOr0(d);
					}
					return merged;
				}
				return row;
			}
			if (!rowMatches(clean, where)) return null;
			const created: Record<string, unknown> = { ...clean };
			for (const [col, d] of Object.entries(deltas)) {
				created[col] = toBigIntOr0(d);
			}
			return created;
		}
		case "update":
			return row && rowMatches(row, op.data)
				? { ...row, ...(op.set ?? {}) }
				: row;
		case "delete":
			return row && rowMatches(row, op.data) ? null : row;
	}
}

// ── Helpers — mirrors context.ts:977-1013 ──

/** Mirrors `context.ts:977-988`. */
export function stripControlKeys(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const {
		_upsert_keys: _a,
		_upsert_fallback_keys: _b,
		_upsert_fallback_set: _c,
		...clean
	} = data;
	return clean;
}

/** Mirrors `context.ts:990-995`. */
export function valEq(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	return String(a) === String(b);
}

/** Mirrors `context.ts:997-1003`. */
export function rowMatches(
	row: Record<string, unknown>,
	where: Record<string, unknown>,
): boolean {
	return Object.entries(where).every(([k, v]) => valEq(row[k], v));
}

/** Mirrors `context.ts:1005-1013`. */
export function toBigIntOr0(v: unknown): bigint {
	if (typeof v === "bigint") return v;
	if (v == null) return 0n;
	try {
		return BigInt(String(v));
	} catch {
		return 0n;
	}
}
