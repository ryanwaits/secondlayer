import { createHash } from "node:crypto";
import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { Transaction } from "kysely";
import type { FlushManifest } from "./context.ts";
import type { SubscriptionMatcher } from "./emitter-matcher.ts";

/**
 * Emit subscription outbox rows for every flushed write that matches an
 * active subscription. Inserted inside the caller's transaction — the
 * outbox write commits (or rolls back) atomically with the subgraph row
 * writes. Zero outbox inserts if no subs match or the kill-switch is set.
 *
 * Set `SECONDLAYER_EMIT_OUTBOX=false` to bypass entirely — useful during
 * backfills or when a receiver is known-down and operators want to drain
 * tenant writes without producing dead outbox.
 */

let loggedKillSwitch = false;

export function isEmitOutboxEnabled(): boolean {
	return process.env.SECONDLAYER_EMIT_OUTBOX !== "false";
}

function dedupKey(
	subgraphName: string,
	tableName: string,
	blockHeight: number,
	txId: string,
	rowIndex: number,
	row: Record<string, unknown>,
): string {
	// Hash of row content + position → stable across replays of the same
	// block (unique constraint on (subscription_id, dedup_key) catches
	// duplicate emits if the block is reprocessed).
	const canonical = `${subgraphName}:${tableName}:${blockHeight}:${txId}:${rowIndex}:${stableStringify(row)}`;
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function stableStringify(obj: Record<string, unknown>): string {
	const keys = Object.keys(obj).sort();
	return JSON.stringify(
		keys.reduce<Record<string, unknown>>((acc, k) => {
			acc[k] = obj[k];
			return acc;
		}, {}),
	);
}

export async function emitSubscriptionOutbox(
	tx: Transaction<Database>,
	subgraphName: string,
	manifest: FlushManifest,
	matcher: SubscriptionMatcher,
	blockHeight: number,
): Promise<number> {
	if (!isEmitOutboxEnabled()) {
		if (!loggedKillSwitch) {
			logger.warn("SECONDLAYER_EMIT_OUTBOX=false — outbox emission bypassed");
			loggedKillSwitch = true;
		}
		return 0;
	}
	loggedKillSwitch = false;

	if (manifest.count === 0 || matcher.size() === 0) return 0;

	type OutboxInsert = {
		subscription_id: string;
		subgraph_name: string;
		table_name: string;
		block_height: number;
		tx_id: string | null;
		row_pk: Record<string, unknown>;
		event_type: string;
		payload: Record<string, unknown>;
		dedup_key: string;
	};

	const rows: OutboxInsert[] = [];
	for (const write of manifest.writes) {
		// v1: emit on inserts only. Updates + deletes can land in a follow-up.
		if (write.op !== "insert") continue;
		const subs = matcher.match(subgraphName, write.table, write.row);
		if (subs.length === 0) continue;

		const eventType = `${subgraphName}.${write.table}.created`;
		for (const s of subs) {
			rows.push({
				subscription_id: s.id,
				subgraph_name: subgraphName,
				table_name: write.table,
				block_height: blockHeight,
				// Nullish-only — an empty-string txId is still a value (block-level
				// write with no specific tx), not "no tx".
				tx_id: write.pk.txId ?? null,
				row_pk: write.pk,
				event_type: eventType,
				payload: write.row,
				dedup_key: dedupKey(
					subgraphName,
					write.table,
					write.pk.blockHeight,
					write.pk.txId,
					write.pk.rowIndex,
					write.row,
				),
			});
		}
	}

	if (rows.length === 0) return 0;

	// Bulk INSERT with ON CONFLICT DO NOTHING on (subscription_id, dedup_key)
	// so a replayed block is a no-op instead of an error.
	await tx
		.insertInto("subscription_outbox")
		.values(rows)
		.onConflict((oc) =>
			oc.columns(["subscription_id", "dedup_key"]).doNothing(),
		)
		.execute();

	return rows.length;
}
