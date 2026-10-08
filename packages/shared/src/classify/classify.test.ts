import { describe, expect, test } from "bun:test";
import { classify } from "./classify.ts";
import { ClassifierInputError, type Question } from "./types.ts";

const questions = {
	kind: {
		type: "choice",
		instructions: "kind?",
		criteria: { a: "a", b: "b" },
	},
	page: {
		type: "boolean",
		instructions: "page?",
		criteria: { true: "t", false: "f" },
	},
	sev: { type: "score", instructions: "sev?", criteria: ["lo", "mid", "hi"] },
} as const satisfies Record<string, Question>;

const kevEnv = { CLASSIFIER: "kev", KEV_URL: "http://kev.test" };

function stubFetch(handler: (init: RequestInit) => Promise<Response>) {
	let calls = 0;
	const fetchImpl = (async (_u: string, init: RequestInit) => {
		calls++;
		return handler(init);
	}) as unknown as typeof fetch;
	return { fetchImpl, calls: () => calls };
}

const goodBody = {
	model: "kev-test",
	answers: {
		kind: { type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.2 } },
		page: { type: "noul", noul: 0.9 },
		sev: {
			type: "score",
			score: 1.5,
			probabilities: { "0": 0.25, "1": 0.25, "2": 0.5 },
		},
	},
};

describe("classify", () => {
	test("rules provider answers without a network", async () => {
		const r = await classify({
			state: "x",
			questions,
			env: {},
			rules: () => ({ kind: "b", page: false, sev: 1 }),
		});
		expect(r?.provider).toBe("rules");
		expect(r?.answers.kind).toMatchObject({ type: "choice", choice: "b" });
	});

	test("rules provider without a fn returns null", async () => {
		expect(await classify({ state: "x", questions, env: {} })).toBeNull();
	});

	test("kev goes through decide and returns normalized answers", async () => {
		const { fetchImpl } = stubFetch(
			async () => new Response(JSON.stringify(goodBody)),
		);
		const r = await classify({ state: "x", questions, env: kevEnv, fetchImpl });
		expect(r?.provider).toBe("kev");
		expect(r?.modelId).toBe("kev-test");
		const kind = r?.answers.kind;
		expect(kind).toMatchObject({ type: "choice", choice: "a" });
		if (kind?.type === "choice") expect(kind.confidence).toBeCloseTo(0.6, 5);
		const page = r?.answers.page;
		if (page?.type === "boolean") {
			expect(page.probability).toBe(0.9);
			expect(page.confidence).toBeCloseTo(0.8, 5);
		} else throw new Error("expected boolean");
		expect(r?.answers.sev).toMatchObject({ type: "score", score: 1.25 });
	});

	test("hung backend times out to null", async () => {
		const { fetchImpl } = stubFetch(
			(init) =>
				new Promise((_, reject) => {
					init.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const r = await classify({
			state: "x",
			questions,
			env: kevEnv,
			fetchImpl,
			timeoutMs: 50,
		});
		expect(r).toBeNull();
	});

	test("backend 500 gives null", async () => {
		const { fetchImpl } = stubFetch(
			async () => new Response("no", { status: 500 }),
		);
		expect(
			await classify({ state: "x", questions, env: kevEnv, fetchImpl }),
		).toBeNull();
	});

	test("oversized state gives null without calling fetch", async () => {
		const { fetchImpl, calls } = stubFetch(
			async () => new Response(JSON.stringify(goodBody)),
		);
		const r = await classify({
			state: "a".repeat(24_001),
			questions,
			env: kevEnv,
			fetchImpl,
		});
		expect(r).toBeNull();
		expect(calls()).toBe(0);
	});

	test("invalid question definition throws", async () => {
		await expect(
			classify({
				state: "x",
				env: {},
				questions: {
					bad: { type: "choice", instructions: "x", criteria: { only: "one" } },
				},
			}),
		).rejects.toBeInstanceOf(ClassifierInputError);
	});
});
