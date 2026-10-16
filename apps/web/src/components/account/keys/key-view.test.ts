import { describe, expect, test } from "bun:test";
import type { ApiKey } from "@/lib/types";
import { groupKeys, keyFlags, keyForLabel } from "./key-view";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const daysAgo = (n: number) =>
	new Date(NOW.getTime() - n * 24 * 3_600_000).toISOString();

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sl_abc",
	name: "a key",
	status: "active",
	product: "account",
	tier: null,
	createdAt: daysAgo(100),
	lastUsedAt: null,
	...patch,
});

describe("keyFlags", () => {
	test("a never-used key made 31 days ago is stale", () => {
		expect(keyFlags(key({ createdAt: daysAgo(31) }), NOW)).toEqual({
			staleDays: 31,
		});
	});

	test("a key used yesterday is not stale", () => {
		expect(keyFlags(key({ lastUsedAt: daysAgo(1) }), NOW)).toEqual({});
	});

	test("staleness counts from the last use, not creation", () => {
		expect(
			keyFlags(key({ createdAt: daysAgo(200), lastUsedAt: daysAgo(40) }), NOW),
		).toEqual({ staleDays: 40 });
	});

	test("a docs key 4 hours from expiry says so and is never stale", () => {
		const expiresAt = new Date(NOW.getTime() + 4 * 3_600_000).toISOString();
		expect(
			keyFlags(
				key({ product: "docs", expiresAt, createdAt: daysAgo(90) }),
				NOW,
			),
		).toEqual({ expiresInHours: 4 });
	});

	test("a key made for you is never flagged", () => {
		expect(
			keyFlags(key({ product: "tenant", createdAt: daysAgo(90) }), NOW),
		).toEqual({});
	});
});

describe("keyForLabel", () => {
	test("names what each key is for", () => {
		expect(keyForLabel("account")).toBe("Your key");
		expect(keyForLabel("streams")).toBe("Your key");
		expect(keyForLabel("index")).toBe("Your key");
		expect(keyForLabel("docs")).toBe("Docs samples");
		expect(keyForLabel("tenant")).toBe("Your hosted stack");
		expect(keyForLabel("sentinel")).toBe("Sentinel");
	});
});

describe("groupKeys", () => {
	test("splits own keys from the ones made for you and hides revoked or expired", () => {
		const live = new Date(NOW.getTime() + 3_600_000).toISOString();
		const dead = new Date(NOW.getTime() - 3_600_000).toISOString();
		const { own, madeForYou } = groupKeys(
			[
				key({ id: "a" }),
				key({ id: "d", product: "docs", expiresAt: live }),
				key({ id: "x", product: "docs", expiresAt: dead }),
				key({ id: "r", status: "revoked" }),
				key({ id: "t", product: "tenant" }),
				key({ id: "s", product: "sentinel" }),
			],
			NOW,
		);
		expect(own.map((k) => k.id)).toEqual(["a", "d"]);
		expect(madeForYou.map((k) => k.id)).toEqual(["t", "s"]);
	});
});
