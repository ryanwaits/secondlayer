import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	_resetRateLimitStoreForTests,
	getRateLimitStore,
} from "./rate-limit-store.ts";

const LIMIT = 10;
const WINDOW_MS = 15 * 60_000;
const OPTS = { failClosed: true } as const;

beforeEach(async () => {
	await _resetRateLimitStoreForTests();
});

afterEach(async () => {
	await _resetRateLimitStoreForTests();
});

describe("auth verify rate limit (shared store)", () => {
	it("allows the first 10 attempts for an IP", async () => {
		const key = "auth:verify:1.2.3.4";
		for (let i = 1; i <= LIMIT; i++) {
			const result = await getRateLimitStore().check(
				key,
				LIMIT,
				WINDOW_MS,
				OPTS,
			);
			expect(result.allowed).toBe(true);
		}
	});

	it("blocks the 11th attempt for the same IP", async () => {
		const key = "auth:verify:1.2.3.4";
		for (let i = 0; i < LIMIT; i++) {
			await getRateLimitStore().check(key, LIMIT, WINDOW_MS, OPTS);
		}
		const result = await getRateLimitStore().check(key, LIMIT, WINDOW_MS, OPTS);
		expect(result.allowed).toBe(false);
		expect(result.retryAfter).toBeGreaterThan(0);
	});

	it("tracks different IPs independently", async () => {
		const keyA = "auth:verify:1.2.3.4";
		const keyB = "auth:verify:5.6.7.8";

		// Exhaust keyA
		for (let i = 0; i < LIMIT; i++) {
			await getRateLimitStore().check(keyA, LIMIT, WINDOW_MS, OPTS);
		}
		const blockedA = await getRateLimitStore().check(
			keyA,
			LIMIT,
			WINDOW_MS,
			OPTS,
		);
		expect(blockedA.allowed).toBe(false);

		// keyB still has its own fresh budget
		const allowedB = await getRateLimitStore().check(
			keyB,
			LIMIT,
			WINDOW_MS,
			OPTS,
		);
		expect(allowedB.allowed).toBe(true);
	});
});
