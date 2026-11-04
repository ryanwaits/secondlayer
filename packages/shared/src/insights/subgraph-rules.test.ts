import { describe, expect, test } from "bun:test";
import type { HealthSnapshotPoint } from "../subgraphs/health.ts";
import {
	SUBGRAPH_RULES,
	type SubgraphErrorGroupInput,
	type SubgraphRuleInput,
} from "./subgraph-rules.ts";
import type { DetectedInsight } from "./types.ts";

const NOW = new Date("2026-10-15T18:30:00.000Z");
const MIN = 60_000;

const collected: DetectedInsight[] = [];

function snap(
	over: Partial<HealthSnapshotPoint> & { agoMin: number },
): HealthSnapshotPoint {
	const { agoMin, ...rest } = over;
	return {
		captured_at: new Date(NOW.getTime() - agoMin * MIN),
		chain_tip: 1000,
		last_processed_block: 1000,
		rows_written_total: 0,
		total_errors: 0,
		total_processed: 0,
		...rest,
	};
}

function group(
	over: Partial<SubgraphErrorGroupInput> = {},
): SubgraphErrorGroupInput {
	return {
		message: "Cannot read properties of undefined (reading amount)",
		eventType: "ft_transfer",
		sourceName: "transfers",
		count: 40,
		firstSeen: new Date(NOW.getTime() - 4 * 60 * MIN),
		lastSeen: NOW,
		sampleBlockHeight: 9_407_812,
		sampleTxId: `0x4c1e${"0".repeat(52)}a90b`,
		frame: "handler.ts:158",
		...over,
	};
}

function input(over: Partial<SubgraphRuleInput> = {}): SubgraphRuleInput {
	return {
		now: NOW,
		subgraph: { id: "sg-1", name: "pool-payouts", status: "active" },
		snapshots: [],
		errorGroups: [],
		...over,
	};
}

function rule(id: string) {
	const found = SUBGRAPH_RULES.find((r) => r.id === id);
	if (!found) throw new Error(`no rule ${id}`);
	return found;
}

function fire(id: string, i: SubgraphRuleInput) {
	const out = rule(id).evaluate(i);
	if (out) collected.push(out);
	return out;
}

/** Errors rise by `total` across the last 24 hours, one snapshot per hour. */
function errorSnapshots(total: number): HealthSnapshotPoint[] {
	return [
		snap({ agoMin: 23 * 60, total_errors: 0 }),
		snap({ agoMin: 30, total_errors: total }),
	];
}

describe("subgraph_handler_errors", () => {
	test("fires at exactly 10 errors in 24 hours", () => {
		const out = fire(
			"subgraph_handler_errors",
			input({
				snapshots: errorSnapshots(10),
				errorGroups: [
					group(),
					group({ message: "second", eventType: "print_event", count: 5 }),
				],
			}),
		);
		expect(out?.severity).toBe("losing");
		expect(out?.impact).toBe(10);
		expect(out?.resource).toEqual({
			kind: "subgraph",
			id: "pool-payouts",
			name: "pool-payouts",
		});
		expect(out?.handoff.commands).toEqual(["sl subgraphs gaps pool-payouts"]);
		expect(out?.how.facts).toContainEqual([
			"event types in top errors",
			"ft_transfer, print_event",
		]);
		const table = out?.evidence[0];
		expect(table?.kind === "table" && table.rows.length).toBe(2);
	});

	test("lists the events that failed: block, short transaction, short error", () => {
		const out = fire(
			"subgraph_handler_errors",
			input({
				snapshots: errorSnapshots(18),
				errorGroups: [
					group({ message: "x".repeat(200) }),
					group({ sampleBlockHeight: null, sampleTxId: null }),
				],
			}),
		);
		const table = out?.evidence[0];
		if (table?.kind !== "table") throw new Error("expected a table");
		expect(table.title).toBe("Events that failed");
		expect(table.columns).toEqual(["Block", "Transaction", "Error"]);
		expect(table.rows[0]?.slice(0, 2)).toEqual(["#9,407,812", "0x4c1e…a90b"]);
		expect(String(table.rows[0]?.[2]).length).toBeLessThanOrEqual(62);
		expect(table.rows[1]?.slice(0, 2)).toEqual(["unknown", "unknown"]);
	});

	test("counts the rest, names the handler and its line", () => {
		const out = fire(
			"subgraph_handler_errors",
			input({
				snapshots: errorSnapshots(18),
				errorGroups: [group(), group(), group({ frame: null })],
			}),
		);
		const table = out?.evidence[0];
		if (table?.kind !== "table") throw new Error("expected a table");
		// 18 errors, 3 shown, groups first seen 4 hours before 18:30.
		expect(table.facts).toEqual([
			["+15 more since", "14:30 UTC"],
			["Handler", "transfers"],
			["Where", "handler.ts:158"],
		]);
	});

	test("clamps 'since' to the last 24 hours and omits an empty rest", () => {
		const out = fire(
			"subgraph_handler_errors",
			input({
				snapshots: errorSnapshots(10),
				errorGroups: [
					group({
						firstSeen: new Date(NOW.getTime() - 5 * 24 * 60 * MIN),
						frame: null,
					}),
				],
			}),
		);
		const table = out?.evidence[0];
		if (table?.kind !== "table") throw new Error("expected a table");
		expect(table.facts).toEqual([
			["+9 more since", "18:30 UTC"],
			["Handler", "transfers"],
		]);
	});

	test("does not fire at 9 errors", () => {
		expect(
			fire("subgraph_handler_errors", input({ snapshots: errorSnapshots(9) })),
		).toBeNull();
	});

	test("shows at most 3 groups", () => {
		const out = fire(
			"subgraph_handler_errors",
			input({
				snapshots: errorSnapshots(50),
				errorGroups: [group(), group(), group(), group()],
			}),
		);
		const table = out?.evidence[0];
		expect(table?.kind === "table" && table.rows.length).toBe(3);
	});

	test("ignores errors older than 24 hours", () => {
		const old = [
			snap({ agoMin: 40 * 60, total_errors: 0 }),
			snap({ agoMin: 30 * 60, total_errors: 500 }),
			snap({ agoMin: 30, total_errors: 500 }),
		];
		expect(
			fire("subgraph_handler_errors", input({ snapshots: old })),
		).toBeNull();
	});

	test("skips when there is no health history yet", () => {
		expect(rule("subgraph_handler_errors").skip?.(input())).toBe(true);
		expect(
			rule("subgraph_handler_errors").skip?.(
				input({ snapshots: errorSnapshots(0) }),
			),
		).toBe(false);
	});
});

describe("subgraph_lag", () => {
	/** Newest first lags, 5 minutes apart. */
	function lagSnapshots(lags: number[]): HealthSnapshotPoint[] {
		return lags.map((lag, i) =>
			snap({
				agoMin: 5 + i * 5,
				chain_tip: 1000 + lag,
				last_processed_block: 1000,
			}),
		);
	}

	test("fires when the newest 3 snapshots are over 20 blocks behind", () => {
		const out = fire(
			"subgraph_lag",
			input({ snapshots: lagSnapshots([21, 30, 25]) }),
		);
		expect(out?.severity).toBe("will_fail");
		expect(out?.impact).toBe(21);
		expect(out?.handoff.commands).toEqual(["sl subgraphs status pool-payouts"]);
		expect(out?.evidence[0]?.kind).toBe("series");
	});

	test("does not fire at exactly 20 blocks or when one snapshot is caught up", () => {
		expect(
			fire("subgraph_lag", input({ snapshots: lagSnapshots([20, 30, 25]) })),
		).toBeNull();
		expect(
			fire("subgraph_lag", input({ snapshots: lagSnapshots([40, 2, 25]) })),
		).toBeNull();
	});

	test("is losing past 500 blocks and will_fail at exactly 500", () => {
		expect(
			fire("subgraph_lag", input({ snapshots: lagSnapshots([501, 600, 700]) }))
				?.severity,
		).toBe("losing");
		expect(
			fire("subgraph_lag", input({ snapshots: lagSnapshots([500, 600, 700]) }))
				?.severity,
		).toBe("will_fail");
	});

	test("does not fire while reindexing", () => {
		const reindexing = input({
			subgraph: { id: "sg-1", name: "pool-payouts", status: "reindexing" },
			snapshots: lagSnapshots([100, 100, 100]),
		});
		expect(fire("subgraph_lag", reindexing)).toBeNull();
	});

	test("skips with fewer than 3 snapshots that know the tip", () => {
		expect(
			rule("subgraph_lag").skip?.(input({ snapshots: lagSnapshots([50, 50]) })),
		).toBe(true);
		const noTip = [
			snap({ agoMin: 5, chain_tip: null }),
			snap({ agoMin: 10, chain_tip: null }),
			snap({ agoMin: 15, chain_tip: null }),
		];
		expect(rule("subgraph_lag").skip?.(input({ snapshots: noTip }))).toBe(true);
		expect(
			rule("subgraph_lag").skip?.(
				input({ snapshots: lagSnapshots([50, 50, 50]) }),
			),
		).toBe(false);
	});
});

describe("subgraph copy", () => {
	test("no prompt contains code and no copy uses an em dash", () => {
		expect(new Set(collected.map((c) => c.rule))).toEqual(
			new Set(SUBGRAPH_RULES.map((r) => r.id)),
		);
		for (const insight of collected) {
			const prompt = insight.handoff.prompt;
			for (const banned of ["```", "{", "=>", "function", "import", "`"]) {
				expect(prompt).not.toContain(banned);
			}
			for (const text of [
				insight.line,
				insight.meta ?? "",
				insight.lead,
				insight.body,
				prompt,
			]) {
				expect(text).not.toContain("—");
			}
		}
	});
});
