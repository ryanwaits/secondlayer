import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { exampleList } from "../subgraphs/subgraph.fixtures";
import { rowModel } from "../webhooks/rows";
import { FIXTURE_HOURS, summary } from "../webhooks/webhook.fixtures";
import { FINDABLE_MIN, filterRows } from "./filter";
import {
	subgraphStatus,
	subgraphWhyLine,
	trimLeadingName,
	webhookStatus,
	webhookWhyLine,
} from "./status";

const quietSeries = {
	delivered: new Array<number>(168).fill(2),
	failed: new Array<number>(168).fill(0),
};
const insight = (over: Partial<Insight>): Insight =>
	({
		id: "i1",
		rule: "r",
		severity: "will_fail",
		impact: 1,
		resource: { kind: "webhook", id: "wh_deposits", name: "sbtc-deposits" },
		line: "Something",
		lead: "",
		body: "",
		evidence: [],
		handoff: { prompt: "", commands: [] },
		how: { detector: "d", facts: [] },
		createdAt: "2026-10-16T00:00:00Z",
		...over,
	}) as Insight;

describe("webhookStatus", () => {
	test("a delivering webhook says nothing", () => {
		const model = rowModel(summary(), quietSeries, FIXTURE_HOURS, []);
		expect(webhookStatus(model)).toEqual({ group: "ok", label: null });
	});

	test("a webhook still counting says nothing", () => {
		const model = rowModel(summary(), undefined, [], [], false);
		expect(webhookStatus(model)).toEqual({ group: "ok", label: null });
	});

	test("paused wins", () => {
		const model = rowModel(
			summary({ status: "paused" }),
			quietSeries,
			FIXTURE_HOURS,
			[],
		);
		expect(webhookStatus(model)).toEqual({ group: "idle", label: "Paused" });
	});

	test("a failing reading is Failing", () => {
		const model = rowModel(
			summary(),
			{ delivered: quietSeries.failed, failed: new Array(168).fill(2) },
			FIXTURE_HOURS,
			[],
		);
		expect(webhookStatus(model)).toEqual({ group: "alarm", label: "Failing" });
	});

	test("a will-fail insight needs a look", () => {
		const model = rowModel(summary(), quietSeries, FIXTURE_HOURS, [
			insight({ severity: "will_fail" }),
		]);
		expect(webhookStatus(model).label).toBe("Needs a look");
	});
});

describe("trimLeadingName", () => {
	test("drops a leading name and capitalizes the rest", () => {
		expect(
			trimLeadingName(
				"fastpool-pox5-test still sends to a test endpoint",
				"fastpool-pox5-test",
			),
		).toBe("Still sends to a test endpoint");
	});

	test("leaves a line that does not open with the name", () => {
		expect(trimLeadingName("Receiver is rejecting", "sbtc-deposits")).toBe(
			"Receiver is rejecting",
		);
	});

	test("does not trim a name that is only a prefix of a longer word", () => {
		expect(trimLeadingName("sbtc-deposits-v2 is slow", "sbtc-deposits")).toBe(
			"sbtc-deposits-v2 is slow",
		);
	});

	test("matches a shortened address name", () => {
		const name = "sentinel:SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.vault";
		expect(trimLeadingName("sentinel:SP1A27…ADJ7.vault stopped", name)).toBe(
			"Stopped",
		);
	});
});

describe("webhookWhyLine", () => {
	test("the top insight, without the repeated name", () => {
		const model = rowModel(summary(), quietSeries, FIXTURE_HOURS, [
			insight({ line: "sbtc-deposits still sends to a test endpoint" }),
		]);
		expect(webhookWhyLine(model)).toBe("Still sends to a test endpoint");
	});

	test("a healthy row has none", () => {
		const model = rowModel(summary(), quietSeries, FIXTURE_HOURS, []);
		expect(webhookWhyLine(model)).toBeNull();
	});

	test("a row still counting says so", () => {
		const model = rowModel(summary(), undefined, [], [], false);
		expect(webhookWhyLine(model)).toBe("Counting…");
	});
});

describe("subgraphStatus", () => {
	const [tip, lagging] = exampleList;
	if (!tip || !lagging) throw new Error("missing fixtures");

	test("at the tip and backfilled says nothing", () => {
		expect(subgraphStatus(tip, 0)).toEqual({ group: "ok", label: null });
	});

	test("lag is progress, never behind", () => {
		expect(subgraphStatus(lagging, 0)).toEqual({
			group: "idle",
			label: "Catching up · 112 blocks to go",
		});
		expect(
			subgraphStatus({ ...lagging, blocksRemaining: 2_204 }, 0).label,
		).toBe("Catching up · 2,204 blocks to go");
	});

	test("reindexing counts blocks to go, and drops the count at zero", () => {
		expect(
			subgraphStatus({ ...tip, status: "reindexing", blocksRemaining: 1 }, 0)
				.label,
		).toBe("Reindexing · 1 block to go");
		expect(
			subgraphStatus({ ...tip, status: "reindexing", blocksRemaining: 0 }, 0)
				.label,
		).toBe("Reindexing");
	});

	test("handler errors or an errored subgraph is Failing", () => {
		expect(subgraphStatus(tip, 3)).toEqual({
			group: "alarm",
			label: "Failing",
		});
		expect(subgraphStatus({ ...tip, status: "error" }, 0).group).toBe("alarm");
	});

	test("another status is its capitalized name", () => {
		expect(subgraphStatus({ ...tip, status: "stopped" }, 0)).toEqual({
			group: "idle",
			label: "Stopped",
		});
	});

	test("a will-fail insight needs a look and beats the plain reading", () => {
		const top = insight({ severity: "will_fail" });
		expect(subgraphStatus(tip, 0, top).label).toBe("Needs a look");
	});
});

describe("subgraphWhyLine", () => {
	test("handler errors, singular and plural", () => {
		expect(subgraphWhyLine("a", 1)).toBe("1 handler error in 24h");
		expect(subgraphWhyLine("a", 12)).toBe("12 handler errors in 24h");
	});

	test("nothing for a clean subgraph or unloaded health", () => {
		expect(subgraphWhyLine("a", 0)).toBeNull();
		expect(subgraphWhyLine("a", null)).toBeNull();
	});

	test("the top insight wins", () => {
		const top = insight({ line: "bns-registry throws on name-update" });
		expect(subgraphWhyLine("bns-registry", 5, top)).toBe(
			"Throws on name-update",
		);
	});
});

describe("filterRows", () => {
	const rows = [
		{ text: "sbtc-deposits chain hooks.dev", group: "ok" as const },
		{ text: "bns-names chain names.dev", group: "alarm" as const },
		{ text: "dao-votes print votes.dev", group: "idle" as const },
	];
	const run = (q: string, group: "all" | "ok" | "alarm" | "idle" | "hi") =>
		filterRows(
			rows,
			{ q, group },
			(r) => r.text,
			(r) => r.group,
		);

	test("an empty filter keeps everything", () => {
		expect(run("", "all")).toHaveLength(3);
	});

	test("search is case-insensitive over name and route text", () => {
		expect(run("BNS", "all")).toHaveLength(1);
		expect(run("votes.dev", "all")).toHaveLength(1);
		expect(run("  chain  ".trim(), "all")).toHaveLength(2);
	});

	test("status and search combine", () => {
		expect(run("chain", "alarm")).toHaveLength(1);
		expect(run("chain", "idle")).toHaveLength(0);
	});

	test("search and status start at four rows", () => {
		expect(FINDABLE_MIN).toBe(4);
	});
});
