import { describe, expect, test } from "bun:test";
import {
	SUBGRAPH_COMMIT_STEPS,
	SubgraphAdapterCrash,
	type SubgraphCommitStep,
	commitSubgraphAdapter,
	runSubgraphCommitSteps,
} from "./subgraph-adapter.ts";

describe("subgraph adapter", () => {
	test("step order is effects → rows → journal → cursor → receipt → failure", () => {
		expect([...SUBGRAPH_COMMIT_STEPS]).toEqual([
			"effects",
			"rows",
			"journal",
			"cursor",
			"receipt",
			"failure",
		]);
	});

	test("crash matrix: without a wrap, steps up to the fault stay applied", async () => {
		for (const crashAfter of SUBGRAPH_COMMIT_STEPS) {
			const applied: SubgraphCommitStep[] = [];
			const steps = Object.fromEntries(
				SUBGRAPH_COMMIT_STEPS.map((step) => [
					step,
					async () => {
						applied.push(step);
					},
				]),
			) as Record<SubgraphCommitStep, () => Promise<void>>;
			await expect(
				runSubgraphCommitSteps(steps, crashAfter),
			).rejects.toBeInstanceOf(SubgraphAdapterCrash);
			expect(applied).toEqual(
				SUBGRAPH_COMMIT_STEPS.slice(
					0,
					SUBGRAPH_COMMIT_STEPS.indexOf(crashAfter) + 1,
				),
			);
		}
	});

	test("duplicate commit is idempotent when writers are", async () => {
		let writes = 0;
		const noop = async () => {
			writes += 1;
		};
		const input = {
			stage_id: "subgraph:demo",
			effects: [],
			receipts: [],
			writeEffects: noop,
			writeRows: noop,
			writeJournal: noop,
			writeCursor: noop,
			writeReceipts: noop,
			writeFailure: noop,
		};
		await commitSubgraphAdapter(input);
		await commitSubgraphAdapter(input);
		expect(writes).toBe(12);
	});

	test("a wrapping rollback undoes a concurrent-writer crash", async () => {
		const applied: string[] = [];
		await expect(
			commitSubgraphAdapter(
				{
					stage_id: "subgraph:demo",
					effects: [],
					receipts: [],
					writeEffects: async () => {
						applied.push("effects");
					},
					writeRows: async () => {
						applied.push("rows");
					},
					writeJournal: async () => {
						applied.push("journal");
					},
					writeCursor: async () => {
						applied.push("cursor");
					},
					writeReceipts: async () => {
						applied.push("receipt");
					},
					writeFailure: async () => {
						applied.push("failure");
					},
					crashAfter: "journal",
				},
				async (fn) => {
					try {
						await fn();
					} catch (error) {
						applied.length = 0;
						throw error;
					}
				},
			),
		).rejects.toBeInstanceOf(SubgraphAdapterCrash);
		expect(applied).toEqual([]);
	});
});
