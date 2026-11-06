import { describe, expect, test } from "bun:test";
import { firstRowsGuideMayShow, keyState } from "./onboarding";
import type { ApiKey } from "./types";

const NOW = new Date("2026-10-15T12:00:00.000Z");

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sl_abc",
	name: "a key",
	status: "active",
	product: "account",
	tier: null,
	createdAt: "2026-07-01T00:00:00.000Z",
	lastUsedAt: null,
	...patch,
});

describe("keyState", () => {
	test("keys not loaded yet is loading", () => {
		expect(keyState(null, NOW)).toBe("loading");
	});

	test("an account that never made a key is first", () => {
		expect(keyState([], NOW)).toBe("first");
	});

	test("an account whose own keys are all revoked has none active", () => {
		expect(keyState([key({ status: "revoked" })], NOW)).toBe("none_active");
	});

	test("docs keys alone never make an account established", () => {
		expect(keyState([key({ product: "docs" })], NOW)).toBe("first");
		expect(keyState([key({ product: "docs", status: "revoked" })], NOW)).toBe(
			"first",
		);
	});

	test("one active own key is active even beside revoked ones", () => {
		expect(
			keyState([key({ status: "revoked", id: "a" }), key({ id: "b" })], NOW),
		).toBe("active");
	});

	test("keys made for the reader are not their own", () => {
		expect(keyState([key({ product: "tenant" })], NOW)).toBe("first");
		expect(keyState([key({ product: "sentinel" })], NOW)).toBe("first");
	});
});

describe("firstRowsGuideMayShow", () => {
	const used = key({ lastUsedAt: "2026-10-14T00:00:00.000Z" });

	test("keys not read yet keep the blocks", () => {
		expect(firstRowsGuideMayShow(null, NOW, false)).toBe(true);
	});

	test("a new account with no keys keeps the blocks", () => {
		expect(firstRowsGuideMayShow([], NOW, false)).toBe(true);
	});

	test("a key that has not read or pushed anything keeps the blocks", () => {
		expect(firstRowsGuideMayShow([key({})], NOW, false)).toBe(true);
	});

	test("a key that has read skips the blocks", () => {
		expect(firstRowsGuideMayShow([used], NOW, false)).toBe(false);
	});

	test("a key with a webhook or subgraph skips the blocks", () => {
		expect(firstRowsGuideMayShow([key({})], NOW, true)).toBe(false);
	});

	test("an account that revoked every key skips the blocks", () => {
		expect(
			firstRowsGuideMayShow([key({ status: "revoked" })], NOW, false),
		).toBe(false);
	});
});
