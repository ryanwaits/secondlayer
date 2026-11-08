import { describe, expect, test } from "bun:test";
import {
	blocksLabel,
	formatBytes,
	groupDigits,
	handlerErrors24h,
	shortCount,
	stateLine,
	subgraphSync,
	subgraphTone,
	syncPercent,
} from "./subgraph-view";

describe("groupDigits", () => {
	test("groups in threes without losing digits past 2^53", () => {
		expect(groupDigits("9007199254740993")).toBe("9,007,199,254,740,993");
		expect(groupDigits("-1234")).toBe("-1,234");
	});

	test("leaves non-digit strings alone", () => {
		expect(groupDigits("1.5")).toBe("1.5");
		expect(groupDigits("abc")).toBe("abc");
	});
});

describe("counts and lag", () => {
	test("a subgraph under two blocks behind is synced, from two blocks it is catching up", () => {
		const at = (behind: number) =>
			subgraphSync({
				status: "active",
				lastProcessedBlock: 1000,
				blocksRemaining: behind,
			});
		expect(at(0)).toBe("synced");
		expect(at(1)).toBe("synced");
		expect(at(2)).toBe("catching_up");
	});

	test("reindexing and error win over how far behind the cursor is", () => {
		const base = { lastProcessedBlock: 1000, blocksRemaining: 0 };
		expect(subgraphSync({ ...base, status: "reindexing" })).toBe("reindexing");
		expect(subgraphSync({ ...base, status: "error" })).toBe("error");
	});

	test("a detail read measures against its own chain tip", () => {
		const item = { status: "active", lastProcessedBlock: 900 };
		expect(subgraphSync(item, 1000)).toBe("catching_up");
		expect(subgraphSync(item, 901)).toBe("synced");
	});

	test("short counts and storage", () => {
		expect(shortCount(412_880)).toBe("413k");
		expect(shortCount(31_077)).toBe("31k");
		expect(shortCount(241)).toBe("241");
		expect(shortCount(1_250_000)).toBe("1.3M");
		expect(formatBytes(1_200_000_000)).toBe("1.2 GB");
		expect(formatBytes(340_000_000)).toBe("340 MB");
	});

	test("state line", () => {
		expect(stateLine("synced", 1, 412_880, 0)).toBe(
			"At the tip · 412,880 rows · 0 errors 24h",
		);
		expect(stateLine("catching_up", 40, 1, 2)).toBe(
			`Behind tip ${blocksLabel(40)} · 1 row · 2 errors 24h`,
		);
		expect(stateLine("catching_up", 5, 10, null)).toBe(
			"Behind tip 5 blocks · 10 rows",
		);
		expect(stateLine("reindexing", 300, 10, 0)).toBe(
			"Reindexing · 300 blocks left · 10 rows · 0 errors 24h",
		);
	});

	test("handler errors in 24h sum the newest 24 hourly buckets", () => {
		const hours = Array.from({ length: 30 }, (_, i) => ({
			errors: i < 6 ? 100 : 1,
		}));
		expect(handlerErrors24h({ hours })).toBe(24);
		expect(handlerErrors24h({ hours: [] })).toBe(0);
		expect(handlerErrors24h(undefined)).toBeNull();
	});

	test("tone is red for errors, quiet when not active", () => {
		expect(subgraphTone("active", 0)).toBe("ok");
		expect(subgraphTone("active", null)).toBe("ok");
		expect(subgraphTone("active", 2)).toBe("alarm");
		expect(subgraphTone("error", 0)).toBe("alarm");
		expect(subgraphTone("reindexing", 0)).toBe("idle");
	});
});

describe("syncPercent", () => {
	test("reads the block share as a whole percent", () => {
		expect(syncPercent({ blocksRemaining: 8_355_052, progress: 0.0734 })).toBe(
			7,
		);
	});
	test("prefers event counts when the operation reports them", () => {
		expect(
			syncPercent({
				blocksRemaining: 500,
				progress: 0.1,
				processedEvents: 600,
				estimatedEvents: 1_000,
			}),
		).toBe(60);
	});
	test("never reads 100 while blocks remain", () => {
		expect(syncPercent({ blocksRemaining: 3, progress: 0.99999 })).toBe(99);
		expect(syncPercent({ blocksRemaining: 0, progress: 1 })).toBe(100);
	});
	test("is null with nothing to go on", () => {
		expect(syncPercent({ blocksRemaining: 10 })).toBeNull();
		expect(
			syncPercent({
				blocksRemaining: 10,
				processedEvents: 5,
				estimatedEvents: 0,
			}),
		).toBeNull();
	});
});
