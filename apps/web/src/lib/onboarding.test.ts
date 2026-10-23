import { describe, expect, test } from "bun:test";
import { accountStage, keyState } from "./onboarding";
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

describe("accountStage", () => {
	const read = { lastUsedAt: "2026-10-15T11:59:00.000Z" };

	test("keys not loaded yet is loading", () => {
		expect(accountStage(null, NOW, false, false)).toBe("loading");
	});

	test("an account that never made a key is no_key", () => {
		expect(accountStage([], NOW, false, false)).toBe("no_key");
	});

	test("a key that has not read is no_reads", () => {
		expect(accountStage([key({})], NOW, false, false)).toBe("no_reads");
	});

	test("a skipped account with an unread key is reading", () => {
		expect(accountStage([key({})], NOW, false, true)).toBe("reading");
	});

	test("a key that has read, with nothing pushed, is reading", () => {
		expect(accountStage([key(read)], NOW, false, false)).toBe("reading");
	});

	test("a webhook or subgraph makes it running, read or not", () => {
		expect(accountStage([key({})], NOW, true, false)).toBe("running");
		expect(accountStage([key(read)], NOW, true, false)).toBe("running");
	});

	test("revoked keys with nothing pushed is reading, with something pushed running", () => {
		const revoked = [key({ status: "revoked" })];
		expect(accountStage(revoked, NOW, false, false)).toBe("reading");
		expect(accountStage(revoked, NOW, true, false)).toBe("running");
	});

	test("a docs key's read never counts", () => {
		expect(
			accountStage(
				[key({}), key({ id: "d", product: "docs", ...read })],
				NOW,
				false,
				false,
			),
		).toBe("no_reads");
	});
});
