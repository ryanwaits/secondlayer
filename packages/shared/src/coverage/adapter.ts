/**
 * Atomic decoder adapter.
 *
 * One transaction writes decoded output, the decoder checkpoint, and an
 * optional failure. A crash after any step rolls all three back.
 *
 * `crashAfter` is a test probe. It throws inside the transaction so the
 * matrix can abort after each step without simulating a real process kill.
 */

import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Database } from "../db/types.ts";
import type { FailureClass, FailureUnit, RetryState } from "./constraints.ts";

export const DECODER_COMMIT_STEPS = [
	"output",
	"checkpoint",
	"failure",
] as const;
export type DecoderCommitStep = (typeof DECODER_COMMIT_STEPS)[number];

export class DecoderAdapterCrash extends Error {
	readonly name = "DecoderAdapterCrash";
	constructor(readonly step: DecoderCommitStep) {
		super(`decoder adapter crash after ${step}`);
	}
}

export type DecoderAdapterFailure = {
	unit_kind: FailureUnit;
	class: FailureClass;
	retry_state: Exclude<RetryState, "resolved">;
	from_height: number | null;
	to_height: number | null;
	error: string | null;
	retry_count?: number;
};

export type DecoderAdapterCommit = {
	stage_id: string;
	decoder_name: string;
	/** Null = do not move the checkpoint (empty page). */
	checkpoint_cursor: string | null;
	failure?: DecoderAdapterFailure | null;
	writeOutput: (tx: Kysely<Database>) => Promise<void>;
	crashAfter?: DecoderCommitStep;
};

export async function runDecoderCommitSteps(
	steps: Record<DecoderCommitStep, () => Promise<void>>,
	crashAfter?: DecoderCommitStep,
): Promise<void> {
	for (const step of DECODER_COMMIT_STEPS) {
		await steps[step]();
		if (crashAfter === step) throw new DecoderAdapterCrash(step);
	}
}

async function upsertRegistry(
	tx: Kysely<Database>,
	stageId: string,
): Promise<void> {
	await tx
		.insertInto("stage_registry")
		.values({
			id: stageId,
			kind: "decode",
			depends_on: null,
			native_clock: "block",
			producer_version: "v1",
			repair_mode: "full_reindex",
		})
		.onConflict((oc) => oc.column("id").doNothing())
		.execute();
}

const CHECKPOINT_CURSOR = /^(\d+):(\d+)$/;

/**
 * Set a decoder's checkpoint to `cursor`, backward or forward. The one
 * unconditional checkpoint writer: reorg handlers rewind decoders to the fork
 * point through it, and reset tools reposition them. The commit path
 * (`writeCheckpoint`) only moves forward.
 */
export async function rewindDecoderCheckpoint(
	db: Kysely<Database>,
	decoderName: string,
	cursor: string | null,
): Promise<void> {
	await db
		.insertInto("decoder_checkpoints")
		.values({ decoder_name: decoderName, last_cursor: cursor })
		.onConflict((oc) =>
			oc.column("decoder_name").doUpdateSet({
				last_cursor: cursor,
				updated_at: new Date(),
			}),
		)
		.execute();
}

async function writeCheckpoint(
	tx: Kysely<Database>,
	decoderName: string,
	cursor: string | null,
): Promise<void> {
	if (cursor === null) return;
	// An idle decoder still calls onBatch on every empty poll (the SDK's
	// no-sink consume loop, packages/sdk/src/streams/consumer.ts, invokes it
	// unconditionally — see `onBatch` in the no-sink branch), which re-commits
	// the SAME cursor every `DECODER_EMPTY_BACKOFF_MS`. With ~15 decoders
	// idling on ~1s backoff, an unconditional write+NOTIFY here fired
	// `index:tip` up to ~15x/sec with ZERO actual progress, waking every
	// pending Index long-poll to recheck for nothing. The `WHERE` makes "did
	// this actually change" an atomic compare-and-skip at the database: the
	// conflicting row is left untouched (and `RETURNING` yields nothing)
	// whenever the incoming cursor matches what's already stored, so a
	// no-op poll costs one INSERT attempt, not a write + a NOTIFY fan-out.
	// Forward-only: the guard compares the parsed `(height, index)`, never the
	// text, and only a strictly greater cursor writes. A commit built from a
	// stale read (a slow batch finishing after a faster one, a retry replaying
	// an old page) is skipped instead of moving the checkpoint backward and
	// making the decoder re-emit rows. Equal cursors skip too, which is the
	// compare-and-skip above. A reorg rewinds through `rewindDecoderCheckpoint`.
	// An unset or unparseable stored cursor counts as behind: `last_cursor`
	// starts NULL for a decoder that has never committed, and SQL's
	// `NULL < x` is NULL (falsy), which would drop the very first commit.
	const parsed = CHECKPOINT_CURSOR.exec(cursor);
	if (!parsed) {
		throw new Error(
			`decoder checkpoint cursor must be "<height>:<index>", got "${cursor}" (${decoderName})`,
		);
	}
	const height = parsed[1] as string;
	const index = parsed[2] as string;
	const written = await tx
		.insertInto("decoder_checkpoints")
		.values({
			decoder_name: decoderName,
			last_cursor: cursor,
		})
		.onConflict((oc) =>
			oc
				.column("decoder_name")
				.doUpdateSet({
					last_cursor: cursor,
					updated_at: new Date(),
				})
				.where(
					sql<boolean>`(
						decoder_checkpoints.last_cursor IS NULL
						OR decoder_checkpoints.last_cursor !~ '^[0-9]+:[0-9]+$'
						OR (
							split_part(decoder_checkpoints.last_cursor, ':', 1)::bigint,
							split_part(decoder_checkpoints.last_cursor, ':', 2)::bigint
						) < (${height}::bigint, ${index}::bigint)
					)`,
				),
		)
		.returning("last_cursor")
		.execute();
	if (written.length === 0) return;

	// Every decoder (classic + protocol) funnels its checkpoint write through
	// here, so this is the one place a `index:tip` NOTIFY can cover the whole
	// decoder set. Postgres defers delivery until the transaction commits,
	// so a rewound/rolled-back commit never fires it. A caller (the Index
	// API's long-poll wake) only needs to know "something committed,
	// go recheck" — it re-reads the real committed height itself, so the
	// payload doesn't need to be more specific than the decoder name.
	await sql`SELECT pg_notify('index:tip', ${decoderName})`.execute(tx);
}

async function writeFailure(
	tx: Kysely<Database>,
	stageId: string,
	failure: DecoderAdapterFailure,
): Promise<void> {
	await tx
		.insertInto("stage_failures")
		.values({
			stage_id: stageId,
			unit_kind: failure.unit_kind,
			from_height: failure.from_height,
			to_height: failure.to_height,
			class: failure.class,
			retry_state: failure.retry_state,
			retry_count: failure.retry_count ?? 0,
			last_error: failure.error,
		})
		.execute();
}

/**
 * Persist output + checkpoint + failure in one transaction. The registry row
 * is upserted only when a failure is written, to satisfy the
 * `stage_failures.stage_id` foreign key.
 *
 * No production caller (decoders use the batch form); kept as the exported
 * single-decoder entry point and covered by decoder-adapter-crash.test.ts.
 */
export async function commitDecoderAdapter(
	db: Kysely<Database>,
	input: DecoderAdapterCommit,
): Promise<void> {
	const failure = input.failure ?? null;
	await db.transaction().execute(async (tx) => {
		await runDecoderCommitSteps(
			{
				output: () => input.writeOutput(tx),
				checkpoint: () =>
					writeCheckpoint(tx, input.decoder_name, input.checkpoint_cursor),
				failure: async () => {
					if (!failure) return;
					await upsertRegistry(tx, input.stage_id);
					await writeFailure(tx, input.stage_id, failure);
				},
			},
			input.crashAfter,
		);
	});
}

/**
 * Same commit as {@link commitDecoderAdapter}, for several decoders sharing
 * ONE outer transaction and ONE read of the source events they were fed
 * from — the in-process classic-decoder loop's shape: 11
 * checkpoints + their decoded rows land together, so a crash mid-batch
 * cannot leave one type's checkpoint ahead of another's rows.
 *
 * Steps run in three PASSES across the whole batch, not step-by-step per
 * entry, so the global order stays output → checkpoint → failure
 * (matching the single-entry commit) while every entry's output — including
 * its `assertCheckpointUnmoved` FOR UPDATE check — lands before any entry's
 * new checkpoint is written. Entries are locked in the order given, which
 * callers must keep identical to `handleDecodedEventsReorg`'s decoder-name
 * order so the two paths never take checkpoint-row locks in conflicting
 * order (deadlock risk otherwise). No per-entry `crashAfter` probe — that
 * stays on the single-entry path.
 */
export async function commitDecoderAdapterBatch(
	db: Kysely<Database>,
	inputs: readonly Omit<DecoderAdapterCommit, "crashAfter">[],
): Promise<void> {
	await db.transaction().execute(async (tx) => {
		for (const input of inputs) {
			await input.writeOutput(tx);
		}
		for (const input of inputs) {
			await writeCheckpoint(tx, input.decoder_name, input.checkpoint_cursor);
		}
		for (const input of inputs) {
			const failure = input.failure ?? null;
			if (failure) {
				await upsertRegistry(tx, input.stage_id);
				await writeFailure(tx, input.stage_id, failure);
			}
		}
	});
}
