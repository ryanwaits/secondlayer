import { describe, expect, test } from "bun:test";
import {
	DECODER_COMMIT_STEPS,
	DecoderAdapterCrash,
	type DecoderAdapterReceipt,
	type DecoderCommitStep,
	applyDecoderReceipts,
	runDecoderCommitSteps,
} from "./adapter.ts";
import { inputDigest } from "./decoder-clock.ts";
import { createRunnerState } from "./runner.ts";

function adapterReceipt(
	height: number,
	opts?: Partial<DecoderAdapterReceipt>,
): DecoderAdapterReceipt {
	const cursors = opts?.input_cursors ?? [`${height}:0`];
	return {
		height,
		hash: `0x${height}`,
		input_count: cursors.length,
		input_cursors: cursors,
		input_digest: inputDigest(cursors),
		through_cursor: cursors[cursors.length - 1] ?? `${height}:0`,
		no_match: cursors.length === 0,
		effect_digest: "e",
		...opts,
	};
}

describe("commit step order", () => {
	test("the matrix is output → checkpoint → receipt → failure", () => {
		expect([...DECODER_COMMIT_STEPS]).toEqual([
			"output",
			"checkpoint",
			"receipt",
			"failure",
		]);
	});
});

describe("crash matrix (in-memory)", () => {
	function recording(): {
		applied: DecoderCommitStep[];
		steps: Record<DecoderCommitStep, () => Promise<void>>;
	} {
		const applied: DecoderCommitStep[] = [];
		const steps = Object.fromEntries(
			DECODER_COMMIT_STEPS.map((step) => [
				step,
				async () => {
					applied.push(step);
				},
			]),
		) as Record<DecoderCommitStep, () => Promise<void>>;
		return { applied, steps };
	}

	test("without a transaction, a crash leaves every step up to the fault", async () => {
		for (const crashAfter of DECODER_COMMIT_STEPS) {
			const { applied, steps } = recording();
			await expect(
				runDecoderCommitSteps(steps, crashAfter),
			).rejects.toBeInstanceOf(DecoderAdapterCrash);
			expect(applied).toEqual(
				DECODER_COMMIT_STEPS.slice(
					0,
					DECODER_COMMIT_STEPS.indexOf(crashAfter) + 1,
				),
			);
		}
	});

	test("a wrapping rollback undoes every step when any one crashes", async () => {
		for (const crashAfter of DECODER_COMMIT_STEPS) {
			const { applied, steps } = recording();
			const snapshot = [...applied];
			try {
				await runDecoderCommitSteps(steps, crashAfter);
			} catch (error) {
				expect(error).toBeInstanceOf(DecoderAdapterCrash);
				applied.length = 0;
			}
			expect(applied).toEqual(snapshot);
		}
	});

	test("no crashAfter runs every step once", async () => {
		const { applied, steps } = recording();
		await runDecoderCommitSteps(steps);
		expect(applied).toEqual([...DECODER_COMMIT_STEPS]);
	});
});

describe("applyDecoderReceipts", () => {
	test("starts a pending run and acks in order", () => {
		const started = applyDecoderReceipts(
			createRunnerState({
				stage_id: "decode:ft_transfer",
				start_height: 10,
				target_height: 12,
				version: { code_hash: "c", config_hash: "k", handler_hash: null },
			}),
			[adapterReceipt(10), adapterReceipt(11), adapterReceipt(12)],
		);
		expect(started.ok).toBe(true);
		if (started.ok) expect(started.state.complete_through).toBe(12);
	});

	test("refuses an out-of-order receipt before any write", () => {
		const result = applyDecoderReceipts(
			createRunnerState({
				stage_id: "decode:ft_transfer",
				start_height: 10,
				version: { code_hash: "c", config_hash: "k", handler_hash: null },
			}),
			[adapterReceipt(11)],
		);
		expect(result.ok).toBe(false);
	});
});
