import { describe, expect, test } from "bun:test";
import type { Insight } from "../schemas/insights.ts";
import { rankInsights } from "./rank.ts";

function make(over: Partial<Insight> & { id: string }): Insight {
	return {
		rule: "r",
		severity: "costs",
		impact: 0,
		resource: { kind: "account", id: "account", name: "Account" },
		line: "",
		lead: "",
		body: "",
		evidence: [],
		handoff: { prompt: "", commands: [] },
		how: { detector: "", facts: [] },
		createdAt: "2026-10-15T00:00:00.000Z",
		...over,
	};
}

describe("rankInsights", () => {
	test("orders losing, will_fail, costs, recovered", () => {
		const out = rankInsights([
			make({ id: "r", severity: "recovered" }),
			make({ id: "c", severity: "costs" }),
			make({ id: "l", severity: "losing" }),
			make({ id: "w", severity: "will_fail" }),
		]);
		expect(out.map((i) => i.id)).toEqual(["l", "w", "c", "r"]);
	});

	test("breaks severity ties by impact descending", () => {
		const out = rankInsights([
			make({ id: "small", impact: 1 }),
			make({ id: "big", impact: 50 }),
		]);
		expect(out.map((i) => i.id)).toEqual(["big", "small"]);
	});

	test("breaks impact ties by newest createdAt", () => {
		const out = rankInsights([
			make({ id: "old", createdAt: "2026-10-01T00:00:00.000Z" }),
			make({ id: "new", createdAt: "2026-10-14T00:00:00.000Z" }),
		]);
		expect(out.map((i) => i.id)).toEqual(["new", "old"]);
	});

	test("keeps input order for equal keys", () => {
		const out = rankInsights([
			make({ id: "a" }),
			make({ id: "b" }),
			make({ id: "c" }),
		]);
		expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
	});

	test("does not mutate its input", () => {
		const input = [
			make({ id: "c", severity: "costs" }),
			make({ id: "l", severity: "losing" }),
		];
		const copy = structuredClone(input);
		rankInsights(input);
		expect(input).toEqual(copy);
	});
});
