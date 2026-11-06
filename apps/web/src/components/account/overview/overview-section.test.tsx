import { describe, expect, mock, test } from "bun:test";
import {
	OPEN_COOKIE,
	parseOpenChoices,
	resolveOpenId,
	serializeOpenChoices,
} from "@/lib/insight-open";
import {
	OVERVIEW_ROWS,
	type OverviewFirstWave,
	checklistApplies,
	overviewPending,
} from "./overview-section";

describe("Overview sections", () => {
	const loaded: OverviewFirstWave = {
		keys: true,
		billing: true,
		service: true,
		stackState: "running",
		webhooks: true,
		asleep: false,
		subgraphs: true,
		rows: true,
		insights: true,
	};
	const none: OverviewFirstWave = {
		keys: false,
		billing: false,
		service: false,
		stackState: null,
		webhooks: false,
		asleep: false,
		subgraphs: false,
		rows: false,
		insights: false,
	};

	test("nothing waits once everything has loaded", () => {
		expect(overviewPending(loaded)).toEqual({
			list: false,
			strip: false,
			all: false,
		});
	});

	test("a missing slice holds only the section that draws it", () => {
		for (const field of ["webhooks", "subgraphs"] as const) {
			expect(overviewPending({ ...loaded, [field]: false })).toEqual({
				list: true,
				strip: false,
				all: false,
			});
		}
		// The strip's cells skeleton themselves; the rest paint.
		for (const field of ["rows", "service"] as const) {
			expect(overviewPending({ ...loaded, [field]: false })).toEqual({
				list: false,
				strip: false,
				all: false,
			});
		}
	});

	test("insights hold the findings and the strip's flags", () => {
		expect(overviewPending({ ...loaded, insights: false })).toEqual({
			list: true,
			strip: true,
			all: false,
		});
	});

	test("keys hold the list, which they decide the checklist of, not the strip", () => {
		expect(overviewPending({ ...loaded, keys: false })).toEqual({
			list: true,
			strip: false,
			all: false,
		});
	});

	test("a missing balance holds nothing: the month shows a dash", () => {
		expect(overviewPending({ ...loaded, billing: false })).toEqual({
			list: false,
			strip: false,
			all: false,
		});
	});

	test("the list does not wait for webhooks or subgraphs when there is no hosted stack", () => {
		expect(
			overviewPending({
				...loaded,
				stackState: "none",
				webhooks: false,
				subgraphs: false,
			}).list,
		).toBe(false);
	});

	test("an asleep stack counts as its webhooks being known", () => {
		expect(
			overviewPending({ ...loaded, webhooks: false, asleep: true }).list,
		).toBe(false);
	});

	test("only an account with nothing loaded is all pending", () => {
		expect(overviewPending(none).all).toBe(true);
		expect(overviewPending({ ...none, billing: true }).all).toBe(false);
	});
});

describe("checklistApplies", () => {
	test("an account that never made a key gets the checklist", () => {
		expect(checklistApplies("first", false, false)).toBe(true);
	});

	test("an account with a key that has not read yet gets the checklist", () => {
		expect(checklistApplies("active", false, false)).toBe(true);
	});

	test("the first read, a webhook or subgraph, or Skip ends it for good", () => {
		expect(checklistApplies("active", false, true)).toBe(false);
	});

	test("an account whose keys are all revoked gets the normal Overview", () => {
		expect(checklistApplies("none_active", false, false)).toBe(false);
	});

	test("the first key's flow stays up until its Done", () => {
		expect(checklistApplies("active", true, true)).toBe(true);
	});
});

describe("remembered open choice", () => {
	const ids = ["a", "b", "c"];

	test("opens the first by default", () => {
		expect(resolveOpenId(ids, {})).toBe("a");
	});
	test("a saved hide keeps the first closed", () => {
		expect(resolveOpenId(ids, { a: false })).toBeNull();
	});
	test("a saved show on the second opens it instead", () => {
		expect(resolveOpenId(ids, { b: true })).toBe("b");
	});

	test("the cookie round-trips, ids with colons included", () => {
		const choices = { "rule:wh-1": true, b: false };
		const raw = serializeOpenChoices(choices, ["rule:wh-1", "b"]);
		expect(parseOpenChoices(raw)).toEqual(choices);
		// The server may hand it over already decoded.
		expect(parseOpenChoices(decodeURIComponent(raw))).toEqual(choices);
	});
	test("a malformed or missing cookie falls back to the default", () => {
		for (const raw of [
			undefined,
			null,
			"",
			"garbage",
			"a:2~:1~~b",
			"%E0%A4%A",
		]) {
			expect(resolveOpenId(ids, parseOpenChoices(raw))).toBe("a");
		}
		expect(parseOpenChoices("a:0~junk~b:1")).toEqual({ a: false, b: true });
	});
	test("saving drops ids that are gone and keeps the newest 20", () => {
		expect(
			parseOpenChoices(serializeOpenChoices({ a: true, gone: false }, ids)),
		).toEqual({
			a: true,
		});
		const many = Object.fromEntries(
			Array.from({ length: 30 }, (_, i) => [`ins-${i}`, i % 2 === 0]),
		);
		const raw = serializeOpenChoices(many, Object.keys(many));
		const kept = Object.keys(parseOpenChoices(raw));
		expect(kept).toHaveLength(20);
		expect(kept[0]).toBe("ins-10");
		expect(raw.length).toBeLessThan(1024);
	});
});

describe("the server page's saved choices", () => {
	test("reads and parses the cookie", async () => {
		mock.module("next/headers", () => ({
			cookies: async () => ({
				get: (name: string) =>
					name === OPEN_COOKIE ? { value: "a%3A0~b%3A1" } : undefined,
			}),
		}));
		const { savedOpenChoices } = await import("@/lib/server/open-choices");
		expect(await savedOpenChoices()).toEqual({ a: false, b: true });
	});
});

describe("Overview shows each group's newest rows", () => {
	test("the limit is three", () => {
		expect(OVERVIEW_ROWS).toBe(3);
	});
});
