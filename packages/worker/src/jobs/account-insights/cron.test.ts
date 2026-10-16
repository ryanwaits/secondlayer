import { describe, expect, test } from "bun:test";
import { evaluateActiveAccounts, startAccountInsightsCron } from "./cron.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("startAccountInsightsCron", () => {
	test("starts nothing outside platform mode", async () => {
		let listed = 0;
		const stop = startAccountInsightsCron({
			mode: () => "oss",
			firstTickMs: 1,
			intervalMs: 5,
			listAccounts: async () => {
				listed++;
				return [];
			},
		});
		await sleep(30);
		stop();
		expect(listed).toBe(0);
	});

	test("one tick evaluates exactly the listed active accounts", async () => {
		const seen: string[] = [];
		const stop = startAccountInsightsCron({
			mode: () => "platform",
			firstTickMs: 1,
			intervalMs: 60_000,
			listAccounts: async () => ["a1", "a2"],
			evaluate: async (id) => {
				seen.push(id);
			},
		});
		await sleep(40);
		stop();
		expect(seen).toEqual(["a1", "a2"]);
	});

	test("stop prevents later ticks", async () => {
		let runs = 0;
		const stop = startAccountInsightsCron({
			mode: () => "platform",
			firstTickMs: 1,
			intervalMs: 10,
			listAccounts: async () => ["a1"],
			evaluate: async () => {
				runs++;
			},
		});
		await sleep(35);
		stop();
		const after = runs;
		await sleep(40);
		expect(runs).toBe(after);
	});
});

describe("evaluateActiveAccounts", () => {
	test("a failing account does not stop the rest", async () => {
		const seen: string[] = [];
		const count = await evaluateActiveAccounts({
			listAccounts: async () => ["a1", "bad", "a3"],
			evaluate: async (id) => {
				if (id === "bad") throw new Error("boom");
				seen.push(id);
			},
		});
		expect(seen).toEqual(["a1", "a3"]);
		expect(count).toBe(3);
	});
});
