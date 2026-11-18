import { describe, expect, it } from "bun:test";
import { createBatchMembership } from "./batch-membership.ts";

const rows = () =>
	new Map([
		[
			"registry",
			new Map([
				["a", 100],
				["b", 105],
			]),
		],
	]);

describe("batch membership", () => {
	it("factory addresses revealed later in the batch are not visible to earlier blocks", () => {
		const m = createBatchMembership(new Map(), rows());
		expect([...(m.factoryAsOf(102).get("registry") ?? [])]).toEqual(["a"]);
		expect([...(m.factoryAsOf(105).get("registry") ?? [])].sort()).toEqual([
			"a",
			"b",
		]);
	});

	it("a committed block's discoveries are visible from that height on", () => {
		const m = createBatchMembership(new Map(), rows());
		m.addDiscoveries(103, [{ sourceName: "registry", address: "c" }]);
		expect(m.factoryAsOf(102).get("registry")?.has("c")).toBe(false);
		expect(m.factoryAsOf(103).get("registry")?.has("c")).toBe(true);
	});

	it("every discovering source has an entry even when empty", () => {
		const m = createBatchMembership(
			new Map(),
			new Map([["registry", new Map<string, number>()]]),
		);
		expect(m.factoryAsOf(100).get("registry")).toEqual(new Set());
	});

	it("factoryAsOf returns a fresh map each call", () => {
		const m = createBatchMembership(new Map(), rows());
		m.factoryAsOf(110).get("registry")?.add("zzz");
		expect(m.factoryAsOf(110).get("registry")?.has("zzz")).toBe(false);
	});
});
