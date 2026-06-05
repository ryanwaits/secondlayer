import { describe, expect, test } from "bun:test";
import {
	InProcRateLimitStore,
	RedisRateLimitStore,
} from "./rate-limit-store.ts";

describe("InProcRateLimitStore", () => {
	test("allows up to the limit, then blocks", async () => {
		const s = new InProcRateLimitStore();
		for (let i = 0; i < 3; i++) {
			expect((await s.check("k", 3, 60_000)).allowed).toBe(true);
		}
		const blocked = await s.check("k", 3, 60_000);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfter).toBeGreaterThan(0);
	});

	test("namespaced keys are independent", async () => {
		const s = new InProcRateLimitStore();
		await s.check("a", 1, 60_000);
		expect((await s.check("b", 1, 60_000)).allowed).toBe(true);
		expect((await s.check("a", 1, 60_000)).allowed).toBe(false);
	});

	test("distinct windowMs use separate windows", async () => {
		const s = new InProcRateLimitStore();
		await s.check("k", 1, 1_000);
		expect((await s.check("k", 1, 60_000)).allowed).toBe(true);
	});

	test("clear resets state", async () => {
		const s = new InProcRateLimitStore();
		await s.check("k", 1, 60_000);
		await s.clear();
		expect((await s.check("k", 1, 60_000)).allowed).toBe(true);
	});
});

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisRateLimitStore", () => {
	test("two instances share one counter (horizontal scale)", async () => {
		const a = new RedisRateLimitStore(REDIS_URL as string);
		const b = new RedisRateLimitStore(REDIS_URL as string);
		const key = `test:${crypto.randomUUID()}`;
		expect((await a.check(key, 2, 60_000)).allowed).toBe(true);
		expect((await b.check(key, 2, 60_000)).allowed).toBe(true);
		// 3rd request across instances exceeds the shared limit of 2.
		expect((await a.check(key, 2, 60_000)).allowed).toBe(false);
	});

	test("window slides — blocked request recovers after expiry", async () => {
		const a = new RedisRateLimitStore(REDIS_URL as string);
		const key = `test:${crypto.randomUUID()}`;
		expect((await a.check(key, 1, 200)).allowed).toBe(true);
		expect((await a.check(key, 1, 200)).allowed).toBe(false);
		await Bun.sleep(260);
		expect((await a.check(key, 1, 200)).allowed).toBe(true);
	});

	test("fails open when redis is unreachable", async () => {
		const bad = new RedisRateLimitStore("redis://127.0.0.1:6398");
		const r = await bad.check("k", 1, 1_000);
		expect(r.allowed).toBe(true);
	});
});
