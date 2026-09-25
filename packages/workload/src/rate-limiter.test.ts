import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./rate-limiter.ts";

describe("createRateLimiter defaults (Design, step 4)", () => {
	test("write: allows 30/min, refuses the 31st", () => {
		const limiter = createRateLimiter({});
		for (let i = 0; i < 30; i++) {
			expect(limiter("acct_1", "write").allowed).toBe(true);
		}
		const decision = limiter("acct_1", "write");
		expect(decision.allowed).toBe(false);
		expect(decision.retryAfterSeconds).toBeGreaterThan(0);
	});

	test("test: allows 10/min, refuses the 11th", () => {
		const limiter = createRateLimiter({});
		for (let i = 0; i < 10; i++) {
			expect(limiter("acct_1", "test").allowed).toBe(true);
		}
		expect(limiter("acct_1", "test").allowed).toBe(false);
	});

	test("replay: allows 5/hour, refuses the 6th", () => {
		const limiter = createRateLimiter({});
		for (let i = 0; i < 5; i++) {
			expect(limiter("acct_1", "replay").allowed).toBe(true);
		}
		expect(limiter("acct_1", "replay").allowed).toBe(false);
	});

	test("read: allows 600/min", () => {
		const limiter = createRateLimiter({});
		for (let i = 0; i < 600; i++) {
			expect(limiter("acct_1", "read").allowed).toBe(true);
		}
		expect(limiter("acct_1", "read").allowed).toBe(false);
	});

	test("buckets and accounts are independent", () => {
		const limiter = createRateLimiter({});
		for (let i = 0; i < 30; i++) limiter("acct_1", "write");
		expect(limiter("acct_1", "write").allowed).toBe(false);
		expect(limiter("acct_1", "read").allowed).toBe(true); // different bucket
		expect(limiter("acct_2", "write").allowed).toBe(true); // different account
	});

	test("the window resets after it elapses", () => {
		let clock = 0;
		const limiter = createRateLimiter({}, () => clock);
		for (let i = 0; i < 30; i++) limiter("acct_1", "write");
		expect(limiter("acct_1", "write").allowed).toBe(false);
		clock += 60_001;
		expect(limiter("acct_1", "write").allowed).toBe(true);
	});
});

describe("createRateLimiter env overrides", () => {
	test("WEBHOOKS_RATE_LIMIT_WRITE_PER_MIN overrides the default of 30", () => {
		const limiter = createRateLimiter({
			WEBHOOKS_RATE_LIMIT_WRITE_PER_MIN: "2",
		});
		expect(limiter("acct_1", "write").allowed).toBe(true);
		expect(limiter("acct_1", "write").allowed).toBe(true);
		expect(limiter("acct_1", "write").allowed).toBe(false);
	});

	test("a non-numeric override falls back to the default", () => {
		const limiter = createRateLimiter({
			WEBHOOKS_RATE_LIMIT_WRITE_PER_MIN: "nope",
		});
		for (let i = 0; i < 30; i++) {
			expect(limiter("acct_1", "write").allowed).toBe(true);
		}
		expect(limiter("acct_1", "write").allowed).toBe(false);
	});
});
