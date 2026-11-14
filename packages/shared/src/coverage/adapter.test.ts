import { describe, expect, test } from "bun:test";
import {
	DECODER_COMMIT_STEPS,
	DecoderAdapterCrash,
	type DecoderCommitStep,
	runDecoderCommitSteps,
} from "./adapter.ts";

describe("commit step order", () => {
	test("the matrix is output → checkpoint → failure", () => {
		expect([...DECODER_COMMIT_STEPS]).toEqual([
			"output",
			"checkpoint",
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
