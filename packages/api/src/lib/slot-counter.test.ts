import { describe, expect, test } from "bun:test";
import { InProcSlotCounter, RedisSlotCounter } from "./slot-counter.ts";

describe("InProcSlotCounter", () => {
	test("refuses past the limit and frees a slot on release", async () => {
		const counter = new InProcSlotCounter();
		const a = await counter.acquire("k", 2, 1_000);
		const b = await counter.acquire("k", 2, 1_000);
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(await counter.acquire("k", 2, 1_000)).toBeNull();

		await a?.();
		expect(await counter.acquire("k", 2, 1_000)).not.toBeNull();
	});

	test("releasing twice frees only one slot", async () => {
		const counter = new InProcSlotCounter();
		const a = await counter.acquire("k", 1, 1_000);
		await a?.();
		await a?.();
		expect(await counter.acquire("k", 1, 1_000)).not.toBeNull();
		expect(await counter.acquire("k", 1, 1_000)).toBeNull();
	});

	test("keys are counted separately", async () => {
		const counter = new InProcSlotCounter();
		expect(await counter.acquire("a", 1, 1_000)).not.toBeNull();
		expect(await counter.acquire("b", 1, 1_000)).not.toBeNull();
	});
});

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisSlotCounter", () => {
	test("two API replicas share one limit", async () => {
		const key = `test-${crypto.randomUUID()}`;
		const replicaA = new RedisSlotCounter(REDIS_URL as string);
		const replicaB = new RedisSlotCounter(REDIS_URL as string);

		const first = await replicaA.acquire(key, 2, 5_000);
		const second = await replicaB.acquire(key, 2, 5_000);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(await replicaA.acquire(key, 2, 5_000)).toBeNull();
		expect(await replicaB.acquire(key, 2, 5_000)).toBeNull();

		await first?.();
		expect(await replicaB.acquire(key, 2, 5_000)).not.toBeNull();
		await second?.();
	});

	test("a slot whose holder never released expires", async () => {
		const key = `test-${crypto.randomUUID()}`;
		const counter = new RedisSlotCounter(REDIS_URL as string);
		expect(await counter.acquire(key, 1, 100)).not.toBeNull();
		expect(await counter.acquire(key, 1, 100)).toBeNull();
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(await counter.acquire(key, 1, 100)).not.toBeNull();
	});

	test("an unreachable Redis grants the slot instead of refusing reads", async () => {
		const counter = new RedisSlotCounter("redis://127.0.0.1:6398");
		expect(await counter.acquire("k", 1, 1_000)).not.toBeNull();
		expect(await counter.acquire("k", 1, 1_000)).not.toBeNull();
	});
});
