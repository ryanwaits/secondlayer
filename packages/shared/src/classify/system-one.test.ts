import { describe, expect, test } from "bun:test";
import { systemOneModel } from "./system-one.ts";

type Captured = {
	url: string;
	init: RequestInit;
	body: {
		model: string;
		state: unknown;
		questions: Record<string, { type: string }>;
	};
};

function stub(response: unknown, status = 200) {
	const captured: Captured[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		captured.push({ url, init, body: JSON.parse(String(init.body)) });
		return new Response(JSON.stringify(response), { status });
	}) as unknown as typeof fetch;
	return { captured, fetchImpl };
}

const questions = {
	esc: {
		type: "boolean",
		instructions: "x",
		criteria: { true: "t", false: "f" },
	},
	dept: { type: "choice", instructions: "x", criteria: { a: "a", b: "b" } },
	sev: { type: "score", instructions: "x", criteria: ["a", "b", "c"] },
} as const;

const textState = [{ type: "text", text: "hello" }] as const;

function model(
	fetchImpl: typeof fetch,
	extra: { apiKey?: string; provider?: "kev" | "clef" } = {},
) {
	return systemOneModel({
		provider: extra.provider ?? "kev",
		url: "http://kev.test/v1/systemone",
		modelId: "kev-latest",
		apiKey: extra.apiKey,
		fetchImpl,
	});
}

// biome-ignore lint/suspicious/noExplicitAny: experimental SDK option types
const call = (m: any, state: any, q: any = questions) =>
	m.doDecide({ state, questions: q });

describe("systemOneModel request", () => {
	test("maps boolean to noul, carries model, unwraps single parts", async () => {
		const { captured, fetchImpl } = stub({ answers: {} });
		await call(model(fetchImpl), textState);
		await call(model(fetchImpl), [{ type: "json", value: { a: 1 } }]);
		await call(model(fetchImpl), [
			{ type: "text", text: "a" },
			{ type: "json", value: { b: 2 } },
		]);
		expect(captured[0]?.body.model).toBe("kev-latest");
		expect(captured[0]?.body.questions.esc.type).toBe("noul");
		expect(captured[0]?.body.questions.dept.type).toBe("choice");
		expect(captured[0]?.body.state).toBe("hello");
		expect(captured[1]?.body.state).toEqual({ a: 1 });
		expect(captured[2]?.body.state).toEqual(["a", { b: 2 }]);
	});

	test("bearer header only when apiKey set", async () => {
		const a = stub({ answers: {} });
		await call(model(a.fetchImpl), textState);
		const b = stub({ answers: {} });
		await call(model(b.fetchImpl, { apiKey: "k" }), textState);
		const hdr = (c: Captured) =>
			(c.init.headers as Record<string, string>).authorization;
		expect(hdr(a.captured[0] as Captured)).toBeUndefined();
		expect(hdr(b.captured[0] as Captured)).toBe("Bearer k");
	});
});

describe("systemOneModel response", () => {
	test("kev bare response maps noul to boolean probability", async () => {
		const { fetchImpl } = stub({
			model: "kev-latest",
			answers: { esc: { type: "noul", noul: 0.93 } },
			usage: { input_tokens: 5, output_tokens: 7 },
		});
		const r = await call(model(fetchImpl), textState);
		expect(r.answers.esc).toEqual({ type: "boolean", probability: 0.93 });
		expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
		expect(r.response.modelId).toBe("kev-latest");
	});

	test("clef result envelope unwraps", async () => {
		const { fetchImpl } = stub({
			result: {
				model: "clef",
				answers: { esc: { type: "noul", noul: 0.2 } },
			},
			success: true,
		});
		const r = await call(model(fetchImpl, { provider: "clef" }), textState);
		expect(r.answers.esc).toEqual({ type: "boolean", probability: 0.2 });
		expect(r.response.modelId).toBe("clef");
	});

	test("probabilities renormalize and score is recomputed", async () => {
		const { fetchImpl } = stub({
			answers: {
				sev: {
					type: "score",
					score: 1.44,
					probabilities: { "0": 0.0, "1": 0.56, "2": 0.43 },
				},
			},
		});
		const r = await call(model(fetchImpl), textState);
		const ps = r.answers.sev.probabilities as Record<string, number>;
		expect(Object.values(ps).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
		const mean = Object.entries(ps).reduce((s, [i, p]) => s + Number(i) * p, 0);
		expect(r.answers.sev.score).toBeCloseTo(mean, 12);
	});

	test("non-2xx throws without the body", async () => {
		const { fetchImpl } = stub({ detail: "SECRET-STATE-ECHO" }, 422);
		let msg = "";
		try {
			await call(model(fetchImpl), textState);
		} catch (e) {
			msg = (e as Error).message;
		}
		expect(msg).toBe("kev 422");
		expect(msg).not.toContain("SECRET");
	});

	test("file part throws", async () => {
		const { fetchImpl } = stub({ answers: {} });
		await expect(
			call(model(fetchImpl), [{ type: "file", data: "x" }]),
		).rejects.toThrow("file state unsupported");
	});
});
