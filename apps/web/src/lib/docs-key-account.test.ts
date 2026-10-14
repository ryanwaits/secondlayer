import { describe, expect, test } from "bun:test";
import { activeKeys, docsKey, expiresIn } from "./account-data";
import type { ApiKey } from "./types";

const key = (over: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sk-sl_12345678",
	name: "Key",
	status: "active",
	product: "account",
	tier: "free",
	createdAt: "2026-10-13T00:00:00Z",
	lastUsedAt: null,
	...over,
});

const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("docs key in the account", () => {
	test("the docs key is not counted among the keys an account manages", () => {
		const keys = [
			key({ id: "a" }),
			key({ id: "d", product: "docs", expiresAt: "2026-10-14T00:00:00Z" }),
		];
		expect(activeKeys(keys).map((k) => k.id)).toEqual(["a"]);
	});

	test("a live docs key is found, an expired or revoked one is not", () => {
		const live = key({
			id: "d",
			product: "docs",
			expiresAt: "2026-10-13T17:00:00Z",
		});
		expect(docsKey([live], NOW)?.id).toBe("d");
		expect(
			docsKey([{ ...live, expiresAt: "2026-10-13T11:00:00Z" }], NOW),
		).toBeNull();
		expect(docsKey([{ ...live, status: "revoked" }], NOW)).toBeNull();
		expect(docsKey(null, NOW)).toBeNull();
	});

	test("expiry reads in hours, then minutes", () => {
		expect(expiresIn("2026-10-13T17:00:00Z", NOW)).toBe("5h");
		expect(expiresIn("2026-10-13T12:40:00Z", NOW)).toBe("40m");
		expect(expiresIn("2026-10-13T12:00:10Z", NOW)).toBe("1m");
	});
});
