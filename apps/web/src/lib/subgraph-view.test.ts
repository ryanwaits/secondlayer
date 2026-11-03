import { describe, expect, test } from "bun:test";
import {
	blocksLabel,
	formatBytes,
	groupDigits,
	handlerErrors24h,
	isLive,
	shortCount,
	stateLine,
	subgraphTone,
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
	test("under two blocks counts as live", () => {
		expect(isLive(0)).toBe(true);
		expect(isLive(1)).toBe(true);
		expect(isLive(2)).toBe(false);
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
		expect(stateLine(1, 412_880, 0)).toBe(
			"At the tip · 412,880 rows · 0 errors 24h",
		);
		expect(stateLine(40, 1, 2)).toBe(
			`Behind tip ${blocksLabel(40)} · 1 row · 2 errors 24h`,
		);
		expect(stateLine(5, 10, null)).toBe("Behind tip 5 blocks · 10 rows");
		expect(stateLine(300, 10, 0, "reindexing")).toBe(
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
