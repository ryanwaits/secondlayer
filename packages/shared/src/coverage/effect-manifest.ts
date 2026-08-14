/**
 * Effect manifests — canonical hash of ordered subgraph mutations per block.
 * Retry and equivalent reorderings of the same ops are stable; a historical
 * defect (different op, table, key, or value) differs.
 */

import { createHash } from "node:crypto";

export type EffectOp = "insert" | "update" | "delete" | "increment";

export type EffectMutation = {
	op: EffectOp;
	table: string;
	key: Record<string, string | number | boolean | null>;
	value?: Record<string, string | number | boolean | null>;
};

export function canonicalizeMutations(
	ops: readonly EffectMutation[],
): EffectMutation[] {
	return ops.map((op) => ({
		op: op.op,
		table: op.table,
		key: sortRecord(op.key),
		value: op.value ? sortRecord(op.value) : undefined,
	}));
}

function sortRecord(
	record: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
	const out: Record<string, string | number | boolean | null> = {};
	for (const key of Object.keys(record).sort()) out[key] = record[key] ?? null;
	return out;
}

export function hashEffectManifest(ops: readonly EffectMutation[]): string {
	const canonical = canonicalizeMutations(ops);
	const hash = createHash("sha256");
	hash.update(JSON.stringify(canonical));
	return hash.digest("hex");
}

export function manifestsEqual(
	a: readonly EffectMutation[],
	b: readonly EffectMutation[],
): boolean {
	return hashEffectManifest(a) === hashEffectManifest(b);
}
