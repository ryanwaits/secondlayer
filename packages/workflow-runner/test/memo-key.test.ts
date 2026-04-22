import { describe, expect, test } from "bun:test";
import { canonicalJSON, memoKey, subStepKey } from "../src/steps/memoKey.ts";

describe("canonicalJSON", () => {
	test("sorts object keys alphabetically", () => {
		const a = canonicalJSON({ b: 1, a: 2, c: 3 });
		const b = canonicalJSON({ a: 2, c: 3, b: 1 });
		expect(a).toEqual(b);
		expect(a).toEqual('{"a":2,"b":1,"c":3}');
	});

	test("sorts nested object keys", () => {
		const a = canonicalJSON({ outer: { z: 1, a: 2 } });
		const b = canonicalJSON({ outer: { a: 2, z: 1 } });
		expect(a).toEqual(b);
	});

	test("preserves array order", () => {
		expect(canonicalJSON([3, 1, 2])).toEqual("[3,1,2]");
	});

	test("serializes BigInt deterministically", () => {
		expect(canonicalJSON(42n)).toEqual('"42n"');
		expect(canonicalJSON({ amount: 100n })).toEqual('{"amount":"100n"}');
	});

	test("throws on symbol", () => {
		expect(() => canonicalJSON(Symbol("x"))).toThrow();
	});
});

describe("memoKey", () => {
	test("stable for same (stepId, input)", () => {
		const a = memoKey("persist", { id: 1, name: "x" });
		const b = memoKey("persist", { name: "x", id: 1 });
		expect(a).toEqual(b);
	});

	test("differs when stepId changes", () => {
		const a = memoKey("persist", { id: 1 });
		const b = memoKey("deliver", { id: 1 });
		expect(a).not.toEqual(b);
	});

	test("differs when input changes", () => {
		const a = memoKey("persist", { id: 1 });
		const b = memoKey("persist", { id: 2 });
		expect(a).not.toEqual(b);
	});

	test("returns a 64-char hex sha256", () => {
		const key = memoKey("x", {});
		expect(key).toMatch(/^[0-9a-f]{64}$/);
	});

	test("handles BigInt stably", () => {
		const a = memoKey("tx", { amount: 100n });
		const b = memoKey("tx", { amount: 100n });
		expect(a).toEqual(b);
		// Different BigInt → different key
		expect(memoKey("tx", { amount: 100n })).not.toEqual(
			memoKey("tx", { amount: 101n }),
		);
	});
});

describe("subStepKey", () => {
	test("dedupes identical (tool, args) pairs within a parent", () => {
		const a = subStepKey("ai-call", "query-db", { id: 1 });
		const b = subStepKey("ai-call", "query-db", { id: 1 });
		expect(a).toEqual(b);
	});

	test("differs across parent, tool, or args", () => {
		const base = subStepKey("p1", "tool", { a: 1 });
		expect(base).not.toEqual(subStepKey("p2", "tool", { a: 1 }));
		expect(base).not.toEqual(subStepKey("p1", "other", { a: 1 }));
		expect(base).not.toEqual(subStepKey("p1", "tool", { a: 2 }));
	});
});
