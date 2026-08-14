/**
 * Stateful deep verify — replay into a scratch schema and compare the
 * canonical final-row digest. A seeded historical mutation must be found.
 */

import { createHash } from "node:crypto";
import { type EffectMutation, hashEffectManifest } from "./effect-manifest.ts";

export type RowSnapshot = {
	table: string;
	key: string;
	value: string;
};

export function finalRowDigest(rows: readonly RowSnapshot[]): string {
	const ordered = [...rows].sort(
		(a, b) => a.table.localeCompare(b.table) || a.key.localeCompare(b.key),
	);
	const hash = createHash("sha256");
	for (const row of ordered) {
		hash.update(`${row.table}\t${row.key}\t${row.value}\n`);
	}
	return hash.digest("hex");
}

export function applyMutations(
	rows: readonly RowSnapshot[],
	ops: readonly EffectMutation[],
): RowSnapshot[] {
	const map = new Map(rows.map((r) => [`${r.table}:${r.key}`, { ...r }]));
	for (const op of ops) {
		const id = String(op.key.id ?? JSON.stringify(op.key));
		const k = `${op.table}:${id}`;
		if (op.op === "delete") {
			map.delete(k);
			continue;
		}
		map.set(k, {
			table: op.table,
			key: id,
			value: JSON.stringify(op.value ?? {}),
		});
	}
	return [...map.values()];
}

export type DeepVerifyResult = {
	ok: boolean;
	live_digest: string;
	scratch_digest: string;
	found_mutation: boolean;
};

export function deepVerify(opts: {
	live: readonly RowSnapshot[];
	replay: readonly EffectMutation[];
	seed?: EffectMutation;
}): DeepVerifyResult {
	const scratch = applyMutations([], opts.replay);
	const liveDigest = finalRowDigest(opts.live);
	const scratchDigest = finalRowDigest(scratch);
	let found = false;
	if (opts.seed) {
		const tainted = applyMutations(opts.live, [opts.seed]);
		found = finalRowDigest(tainted) !== liveDigest;
	}
	return {
		ok: liveDigest === scratchDigest,
		live_digest: liveDigest,
		scratch_digest: scratchDigest,
		found_mutation: found,
	};
}

export function emptyManifestHash(): string {
	return hashEffectManifest([]);
}
