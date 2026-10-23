import { describe, expect, test } from "bun:test";
import type { ApiKey } from "@/lib/types";
import { firstReadKey, firstReadPollMs } from "./use-first-read";

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k1",
	prefix: "sl_abc",
	name: "laptop",
	status: "active",
	product: "account",
	tier: null,
	createdAt: "2026-10-15T00:00:00.000Z",
	lastUsedAt: null,
	...patch,
});

describe("firstReadKey", () => {
	test("returns the key whose lastUsedAt went from null to set", () => {
		const prev = [key({}), key({ id: "k2", name: "ci" })];
		const next = [
			key({}),
			key({ id: "k2", name: "ci", lastUsedAt: "2026-10-15T12:00:00.000Z" }),
		];
		expect(firstReadKey(prev, next)?.name).toBe("ci");
	});

	test("is null when nothing newly read", () => {
		const read = key({ lastUsedAt: "2026-10-15T12:00:00.000Z" });
		expect(firstReadKey([key({})], [key({})])).toBeNull();
		expect(firstReadKey([read], [read])).toBeNull();
	});

	test("a key that appears already read is not a first read", () => {
		const fresh = key({ id: "k9", lastUsedAt: "2026-10-15T12:00:00.000Z" });
		expect(firstReadKey([key({})], [key({}), fresh])).toBeNull();
	});
});

describe("firstReadPollMs", () => {
	test("polls every 5s only while waiting for the first read", () => {
		expect(firstReadPollMs("no_reads")).toBe(5000);
		for (const stage of ["loading", "no_key", "reading", "running"] as const) {
			expect(firstReadPollMs(stage)).toBeNull();
		}
	});
});
