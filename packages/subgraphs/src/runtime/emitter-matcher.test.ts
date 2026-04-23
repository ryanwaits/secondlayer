import { describe, expect, it } from "bun:test";
import type { Subscription } from "@secondlayer/shared/db";
import {
	SubscriptionMatcher,
	matchesFilter,
} from "./emitter-matcher.ts";

function sub(overrides: Partial<Subscription>): Subscription {
	const base: Subscription = {
		id: "00000000-0000-0000-0000-000000000001",
		account_id: "00000000-0000-0000-0000-000000000001",
		project_id: null,
		name: "s",
		status: "active",
		subgraph_name: "sg",
		table_name: "t",
		filter: {},
		format: "standard-webhooks",
		runtime: null,
		url: "https://x",
		signing_secret_enc: Buffer.from(""),
		auth_config: {},
		max_retries: 7,
		timeout_ms: 10000,
		concurrency: 4,
		circuit_failures: 0,
		circuit_opened_at: null,
		last_delivery_at: null,
		last_success_at: null,
		last_error: null,
		created_at: new Date(),
		updated_at: new Date(),
	};
	return { ...base, ...overrides };
}

describe("matchesFilter", () => {
	it("empty filter matches all", () => {
		expect(matchesFilter({}, { a: 1 })).toBe(true);
		expect(matchesFilter(null, { a: 1 })).toBe(true);
		expect(matchesFilter(undefined, { a: 1 })).toBe(true);
	});

	it("scalar equality (shorthand)", () => {
		expect(matchesFilter({ sender: "SP1" }, { sender: "SP1" })).toBe(true);
		expect(matchesFilter({ sender: "SP1" }, { sender: "SP2" })).toBe(false);
	});

	it("eq operator", () => {
		expect(matchesFilter({ n: { eq: 5 } }, { n: 5 })).toBe(true);
		expect(matchesFilter({ n: { eq: 5 } }, { n: 6 })).toBe(false);
	});

	it("neq operator", () => {
		expect(matchesFilter({ n: { neq: 5 } }, { n: 6 })).toBe(true);
		expect(matchesFilter({ n: { neq: 5 } }, { n: 5 })).toBe(false);
	});

	it("gt/gte/lt/lte numeric compares", () => {
		expect(matchesFilter({ n: { gt: 10 } }, { n: 11 })).toBe(true);
		expect(matchesFilter({ n: { gt: 10 } }, { n: 10 })).toBe(false);
		expect(matchesFilter({ n: { gte: 10 } }, { n: 10 })).toBe(true);
		expect(matchesFilter({ n: { lt: 10 } }, { n: 9 })).toBe(true);
		expect(matchesFilter({ n: { lte: 10 } }, { n: 10 })).toBe(true);
	});

	it("in operator", () => {
		expect(matchesFilter({ kind: { in: ["a", "b"] } }, { kind: "a" })).toBe(
			true,
		);
		expect(matchesFilter({ kind: { in: ["a", "b"] } }, { kind: "c" })).toBe(
			false,
		);
	});

	it("ANDs multiple conditions", () => {
		expect(
			matchesFilter({ a: 1, b: { gt: 5 } }, { a: 1, b: 10 }),
		).toBe(true);
		expect(
			matchesFilter({ a: 1, b: { gt: 5 } }, { a: 1, b: 3 }),
		).toBe(false);
	});

	it("bigint row values compare numerically", () => {
		expect(matchesFilter({ amt: { gte: 100 } }, { amt: 500n })).toBe(true);
		expect(matchesFilter({ amt: { gte: 100 } }, { amt: 50n })).toBe(false);
	});

	it("string amount coerces for numeric compare", () => {
		expect(matchesFilter({ amt: { gte: 100 } }, { amt: "500" })).toBe(true);
	});

	it("rejects nested-object filter values", () => {
		// nested unknown operators should never match
		expect(
			matchesFilter(
				{ a: { weird: { nested: 1 } } } as never,
				{ a: 1 },
			),
		).toBe(false);
	});

	it("rejects filter where op object has >1 keys", () => {
		expect(
			matchesFilter({ n: { gt: 1, lt: 10 } } as never, { n: 5 }),
		).toBe(false);
	});

	it("missing row column never matches eq", () => {
		expect(matchesFilter({ missing: "x" }, {})).toBe(false);
	});

	it("boolean scalar match", () => {
		expect(matchesFilter({ active: true }, { active: true })).toBe(true);
		expect(matchesFilter({ active: true }, { active: false })).toBe(false);
	});
});

describe("SubscriptionMatcher cache", () => {
	it("indexes active subs by (subgraph,table) and returns matches", () => {
		const m = new SubscriptionMatcher();
		m.setAll([
			sub({
				id: "a",
				subgraph_name: "bitcoin",
				table_name: "transfers",
				filter: { amount: { gte: 100 } },
			}),
			sub({
				id: "b",
				subgraph_name: "bitcoin",
				table_name: "transfers",
				filter: {},
			}),
			sub({
				id: "c",
				subgraph_name: "bitcoin",
				table_name: "mints",
				filter: {},
			}),
			sub({
				id: "d",
				subgraph_name: "bitcoin",
				table_name: "transfers",
				status: "paused",
				filter: {},
			}),
		]);

		expect(m.size()).toBe(3); // paused sub excluded
		expect(m.has("bitcoin", "transfers")).toBe(true);
		expect(m.has("bitcoin", "burns")).toBe(false);

		const matches = m.match("bitcoin", "transfers", { amount: 200n });
		expect(matches.map((s) => s.id).sort()).toEqual(["a", "b"]);

		const smallMatches = m.match("bitcoin", "transfers", { amount: 50 });
		expect(smallMatches.map((s) => s.id)).toEqual(["b"]);
	});
});
