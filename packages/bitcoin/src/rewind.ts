// Reverses a shallow reorg (D10, `docs/internal/bitcoin-runtime.md`) against
// both Postgres and the in-memory `RuneState`, using the per-block undo
// journal (`runes/undo.ts`) `../db/store.ts`'s `flush` wrote while following
// the tip. Not a port of any ord file — ord re-indexes from scratch on a
// reorg it notices at all; this exists so a reorg no deeper than
// `UNDO_DEPTH` never needs a full rebuild.

import { hexToBytes } from "@noble/hashes/utils.js";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { CHECKPOINT_NAME, type Database } from "./db/types.ts";
import { GENESIS_DIGEST } from "./integrity/digest.ts";
import { checkInvariant } from "./runes/invariant.ts";
import type { RuneState } from "./runes/state.ts";
import {
	UNDO_DEPTH,
	type UndoPayload,
	applyUndoPayload,
	undoPayloadFromJson,
} from "./runes/undo.ts";

/**
 * A reorg deeper than `UNDO_DEPTH` (D10: fail closed) — `rewindTo` writes
 * nothing when this is thrown. The caller must halt ingest (and pages), not
 * retry and never raise `UNDO_DEPTH` to route around it.
 */
export class DeepReorgError extends Error {
	constructor(
		readonly checkpointHeight: number,
		readonly forkHeight: number,
	) {
		super(
			`reorg is ${checkpointHeight - forkHeight} blocks deep, deeper than UNDO_DEPTH=${UNDO_DEPTH}: halting ingest (D10, fail closed)`,
		);
		this.name = "DeepReorgError";
	}
}

/** The undo journal doesn't reach far enough to cover this rewind even though its depth is within `UNDO_DEPTH` — a bug or an unexpectedly short-lived process, not a normal reorg. Fails closed the same as `DeepReorgError`. */
export class MissingUndoDataError extends Error {
	constructor(readonly height: number) {
		super(
			`rewindTo: no rune_undo row at height ${height} — can't reverse this block`,
		);
		this.name = "MissingUndoDataError";
	}
}

function outpointTxid(outpoint: string): string {
	return outpoint.slice(0, outpoint.lastIndexOf(":"));
}
function outpointVout(outpoint: string): number {
	return Number(outpoint.slice(outpoint.lastIndexOf(":") + 1));
}

/** The SQL mirror of `runes/undo.ts`'s `applyUndoPayload`, for one height, against Postgres. */
async function reversePayloadInDb(
	trx: Kysely<Database>,
	payload: UndoPayload,
): Promise<void> {
	const touched = [...payload.balancesSpent, ...payload.balancesCreated];
	if (touched.length > 0) {
		const txids = touched.map((r) => outpointTxid(r.outpoint));
		const vouts = touched.map((r) => outpointVout(r.outpoint));
		const runeIds = touched.map((r) => r.runeId);
		await sql`
			delete from rune_balances b
			using unnest(${sql.val(txids)}::text[], ${sql.val(vouts)}::int[], ${sql.val(runeIds)}::text[])
				as d(txid, vout, rune_id)
			where b.txid = d.txid and b.vout = d.vout and b.rune_id = d.rune_id
		`.execute(trx);
	}

	if (payload.balancesSpent.length > 0) {
		await trx
			.insertInto("rune_balances")
			.values(
				payload.balancesSpent.map((row) => ({
					txid: outpointTxid(row.outpoint),
					vout: outpointVout(row.outpoint),
					rune_id: row.runeId,
					amount: row.amount.toString(),
					address: row.address ?? null,
				})),
			)
			.execute();
	}

	if (payload.entriesEtched.length > 0) {
		await trx
			.deleteFrom("rune_entries")
			.where("rune_id", "in", payload.entriesEtched)
			.execute();
	}

	for (const delta of payload.entryDeltas) {
		await trx
			.updateTable("rune_entries")
			.set({ mints: delta.mints.toString(), burned: delta.burned.toString() })
			.where("rune_id", "=", delta.runeId)
			.execute();
	}

	await trx
		.deleteFrom("rune_events")
		.where("height", "=", payload.height)
		.execute();
	await trx
		.deleteFrom("rune_block_digests")
		.where("height", "=", payload.height)
		.execute();
	await trx
		.deleteFrom("btc_blocks")
		.where("height", "=", payload.height)
		.execute();
	await trx
		.deleteFrom("rune_undo")
		.where("height", "=", payload.height)
		.execute();
}

/**
 * Rewinds both Postgres and `state` from `state.height` (the checkpoint) down
 * to `forkHeight` (left in place as the new checkpoint), one undone block at
 * a time, all in a single transaction. Throws `DeepReorgError` and writes
 * nothing if the reorg is more than `UNDO_DEPTH` blocks deep (D10, fail
 * closed) — the caller must halt, not retry or raise the depth.
 *
 * Mutates `state` in place to reflect the reversal (via
 * `runes/undo.ts`'s `applyUndoPayload`) so `checkInvariant` can run against
 * it before the transaction commits — a violation rolls the whole rewind
 * back, same as `db/store.ts`'s `flush`. Per plan design, the caller should
 * still reload `state` fully afterward (`db/store.ts`'s `loadState`) as a
 * defensive "simplest correct" step before re-applying the new branch; this
 * function's in-memory mutation exists to make that reload's precondition
 * (an invariant-clean state) provable up front, not to replace it.
 */
export async function rewindTo(
	db: Kysely<Database>,
	state: RuneState,
	forkHeight: number,
): Promise<void> {
	const checkpoint = state.height;
	if (checkpoint === undefined) {
		throw new Error("rewindTo: state has no checkpoint to rewind from");
	}
	if (forkHeight >= checkpoint) {
		throw new Error(
			`rewindTo: forkHeight ${forkHeight} must be below the current checkpoint ${checkpoint}`,
		);
	}
	if (checkpoint - forkHeight > UNDO_DEPTH) {
		throw new DeepReorgError(checkpoint, forkHeight);
	}

	const oldTipHash = state.hash;
	const affectedRuneIds = new Set<string>();

	await db.transaction().execute(async (trx) => {
		for (let height = checkpoint; height > forkHeight; height--) {
			const row = await trx
				.selectFrom("rune_undo")
				.selectAll()
				.where("height", "=", height)
				.executeTakeFirst();
			if (!row) throw new MissingUndoDataError(height);

			const payload = undoPayloadFromJson(height, row.payload);
			for (const b of payload.balancesSpent) affectedRuneIds.add(b.runeId);
			for (const b of payload.balancesCreated) affectedRuneIds.add(b.runeId);
			for (const id of payload.entriesEtched) affectedRuneIds.add(id);
			for (const d of payload.entryDeltas) affectedRuneIds.add(d.runeId);

			await reversePayloadInDb(trx, payload);
			applyUndoPayload(state, payload);
		}

		const forkBlock = await trx
			.selectFrom("btc_blocks")
			.select("hash")
			.where("height", "=", forkHeight)
			.executeTakeFirst();
		if (!forkBlock) {
			throw new Error(
				`rewindTo: no btc_blocks row at fork height ${forkHeight}`,
			);
		}
		const forkDigestRow = await trx
			.selectFrom("rune_block_digests")
			.select("digest")
			.where("height", "=", forkHeight)
			.executeTakeFirst();

		await trx
			.updateTable("runes_checkpoint")
			.set({ height: forkHeight, hash: forkBlock.hash, updated_at: new Date() })
			.where("name", "=", CHECKPOINT_NAME)
			.execute();

		await trx
			.insertInto("btc_reorgs")
			.values({
				fork_point_height: forkHeight,
				old_hash: oldTipHash ?? forkBlock.hash,
				new_hash: forkBlock.hash,
				orphaned_from: forkHeight + 1,
				orphaned_to: checkpoint,
				new_tip_height: forkHeight,
			})
			.execute();

		// Fail-closed, same as flush(): a violation rolls the whole rewind back.
		// Excludes any rune whose entry no longer exists after the reversal
		// (etched, then undone, within this same rewind) — checkInvariant's
		// contract assumes every ID it's given still has a live entry.
		const checkableRuneIds = [...affectedRuneIds].filter((id) =>
			state.entries.has(id),
		);
		checkInvariant(state, checkableRuneIds);

		state.height = forkHeight;
		state.hash = forkBlock.hash;
		state.digest = forkDigestRow
			? Uint8Array.from(hexToBytes(forkDigestRow.digest))
			: GENESIS_DIGEST;
	});
}
