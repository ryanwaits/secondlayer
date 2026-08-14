/**
 * Atomic decoder adapter.
 *
 * One transaction writes decoded output, the decoder checkpoint, block
 * receipts, and an optional failure. A crash after any step rolls all
 * four back — the property `commitDecodedBatch` already had for rows+
 * checkpoint, now covering the coverage kernel too.
 *
 * `crashAfter` is a test probe. It throws inside the transaction so the
 * matrix can abort after each step without simulating a real process kill.
 */

import type { Kysely } from "kysely";
import type { Database } from "../db/types.ts";
import type { FailureClass, FailureUnit, RetryState } from "./constraints.ts";
import type { DecoderClockReceipt } from "./decoder-clock.ts";
import {
	type RunnerEvent,
	type RunnerResult,
	type RunnerState,
	applyRunnerEvent,
} from "./runner.ts";

export const DECODER_COMMIT_STEPS = [
	"output",
	"checkpoint",
	"receipt",
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

export type DecoderAdapterReceipt = DecoderClockReceipt & {
	effect_digest: string;
};

export type DecoderAdapterCommit = {
	stage_id: string;
	run_id?: string | null;
	decoder_name: string;
	/** Null = do not move the checkpoint (empty page). */
	checkpoint_cursor: string | null;
	receipts: readonly DecoderAdapterReceipt[];
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

export function applyDecoderReceipts(
	state: RunnerState,
	receipts: readonly DecoderAdapterReceipt[],
): RunnerResult {
	let current = state;
	if (current.status === "pending") {
		const started = applyRunnerEvent(current, { type: "start" });
		if (!started.ok) return started;
		current = started.state;
	}
	for (const receipt of receipts) {
		const event: RunnerEvent = {
			type: "ack",
			height: receipt.height,
			hash: receipt.hash,
			input_count: receipt.input_count,
			input_digest: receipt.input_digest,
			effect_digest: receipt.effect_digest,
		};
		const next = applyRunnerEvent(current, event);
		if (!next.ok) return next;
		current = next.state;
	}
	return { ok: true, state: current, effects: [] };
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

async function writeCheckpoint(
	tx: Kysely<Database>,
	decoderName: string,
	cursor: string | null,
): Promise<void> {
	if (cursor === null) return;
	await tx
		.insertInto("decoder_checkpoints")
		.values({
			decoder_name: decoderName,
			last_cursor: cursor,
		})
		.onConflict((oc) =>
			oc.column("decoder_name").doUpdateSet({
				last_cursor: cursor,
				updated_at: new Date(),
			}),
		)
		.execute();
}

async function writeReceipts(
	tx: Kysely<Database>,
	stageId: string,
	runId: string | null,
	receipts: readonly DecoderAdapterReceipt[],
): Promise<void> {
	if (receipts.length === 0) return;
	await tx
		.insertInto("stage_block_receipts")
		.values(
			receipts.map((receipt) => ({
				stage_id: stageId,
				run_id: runId,
				block_height: receipt.height,
				block_hash: receipt.hash,
				input_count: receipt.input_count,
				input_digest: receipt.input_digest,
				effect_digest: receipt.effect_digest,
			})),
		)
		.onConflict((oc) =>
			oc
				.columns(["stage_id", "block_height", "block_hash"])
				.doUpdateSet((eb) => ({
					input_count: eb.ref("excluded.input_count"),
					input_digest: eb.ref("excluded.input_digest"),
					effect_digest: eb.ref("excluded.effect_digest"),
					run_id: eb.ref("excluded.run_id"),
				})),
		)
		.execute();
}

async function writeFailure(
	tx: Kysely<Database>,
	stageId: string,
	runId: string | null,
	failure: DecoderAdapterFailure,
): Promise<void> {
	await tx
		.insertInto("stage_failures")
		.values({
			stage_id: stageId,
			run_id: runId,
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
 * Persist output + checkpoint + receipts + failure in one transaction.
 * Runner validation is the caller's job (`applyDecoderReceipts`) so a
 * rejected ack never opens a transaction.
 */
export async function commitDecoderAdapter(
	db: Kysely<Database>,
	input: DecoderAdapterCommit,
): Promise<void> {
	const runId = input.run_id ?? null;
	const failure = input.failure ?? null;
	await db.transaction().execute(async (tx) => {
		await upsertRegistry(tx, input.stage_id);
		await runDecoderCommitSteps(
			{
				output: () => input.writeOutput(tx),
				checkpoint: () =>
					writeCheckpoint(tx, input.decoder_name, input.checkpoint_cursor),
				receipt: () => writeReceipts(tx, input.stage_id, runId, input.receipts),
				failure: () =>
					failure
						? writeFailure(tx, input.stage_id, runId, failure)
						: Promise.resolve(),
			},
			input.crashAfter,
		);
	});
}
