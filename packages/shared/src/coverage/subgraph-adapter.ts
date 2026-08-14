/**
 * Atomic subgraph adapter — commit effects, rows, journal, cursor,
 * receipt, and failure in one transaction.
 */

import type { DecoderAdapterFailure } from "./adapter.ts";
import type { DecoderClockReceipt } from "./decoder-clock.ts";
import type { EffectMutation } from "./effect-manifest.ts";

export const SUBGRAPH_COMMIT_STEPS = [
	"effects",
	"rows",
	"journal",
	"cursor",
	"receipt",
	"failure",
] as const;
export type SubgraphCommitStep = (typeof SUBGRAPH_COMMIT_STEPS)[number];

export class SubgraphAdapterCrash extends Error {
	readonly name = "SubgraphAdapterCrash";
	constructor(readonly step: SubgraphCommitStep) {
		super(`subgraph adapter crash after ${step}`);
	}
}

export type SubgraphCommitInput = {
	stage_id: string;
	effects: readonly EffectMutation[];
	receipts: readonly (DecoderClockReceipt & { effect_digest: string })[];
	failure?: DecoderAdapterFailure | null;
	writeEffects: () => Promise<void>;
	writeRows: () => Promise<void>;
	writeJournal: () => Promise<void>;
	writeCursor: () => Promise<void>;
	writeReceipts: () => Promise<void>;
	writeFailure: () => Promise<void>;
	crashAfter?: SubgraphCommitStep;
};

export async function runSubgraphCommitSteps(
	steps: Record<SubgraphCommitStep, () => Promise<void>>,
	crashAfter?: SubgraphCommitStep,
): Promise<void> {
	for (const step of SUBGRAPH_COMMIT_STEPS) {
		await steps[step]();
		if (crashAfter === step) throw new SubgraphAdapterCrash(step);
	}
}

export async function commitSubgraphAdapter(
	input: SubgraphCommitInput,
	wrap: (fn: () => Promise<void>) => Promise<void> = (fn) => fn(),
): Promise<void> {
	await wrap(() =>
		runSubgraphCommitSteps(
			{
				effects: input.writeEffects,
				rows: input.writeRows,
				journal: input.writeJournal,
				cursor: input.writeCursor,
				receipt: input.writeReceipts,
				failure: input.writeFailure,
			},
			input.crashAfter,
		),
	);
}
