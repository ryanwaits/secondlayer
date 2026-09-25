import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EventCounter,
	eventsIdempotencyKey,
	eventsMeterItem,
	flushAll,
	flushMeterBatch,
	memoryIdempotencyKey,
	sampleMemoryGbHour,
	sampleStorageGbDay,
	startMeterSocketServer,
	storageIdempotencyKey,
} from "./meters.ts";

describe("idempotency key shapes (Design)", () => {
	const at = new Date("2026-09-25T14:37:12.000Z");

	test("memory: mem:<account>:<yyyy-mm-ddThh>", () => {
		expect(memoryIdempotencyKey("acct_1", at)).toBe("mem:acct_1:2026-09-25T14");
	});

	test("storage: storage:<account>:<yyyy-mm-dd>", () => {
		expect(storageIdempotencyKey("acct_1", at)).toBe(
			"storage:acct_1:2026-09-25",
		);
	});

	test("events: evt:<account>:<yyyy-mm-ddThh:mm>", () => {
		expect(eventsIdempotencyKey("acct_1", at)).toBe(
			"evt:acct_1:2026-09-25T14:37",
		);
	});

	test("two samples in the same hour produce the same memory key (safe re-send)", () => {
		const a = new Date("2026-09-25T14:01:00.000Z");
		const b = new Date("2026-09-25T14:59:00.000Z");
		expect(memoryIdempotencyKey("acct_1", a)).toBe(
			memoryIdempotencyKey("acct_1", b),
		);
	});
});

describe("EventCounter", () => {
	test("accumulates across multiple add() calls", () => {
		const c = new EventCounter();
		c.add(3);
		c.add(4);
		expect(c.drain()).toBe(7);
	});

	test("drain() zeroes the counter", () => {
		const c = new EventCounter();
		c.add(5);
		c.drain();
		expect(c.drain()).toBe(0);
	});

	test("ignores negative or non-finite pushes", () => {
		const c = new EventCounter();
		c.add(-5);
		c.add(Number.NaN);
		c.add(Number.POSITIVE_INFINITY);
		expect(c.drain()).toBe(0);
	});

	test("floors a fractional push", () => {
		const c = new EventCounter();
		c.add(2.9);
		expect(c.drain()).toBe(2);
	});
});

describe("eventsMeterItem", () => {
	test("zero count produces no item (never a zero-quantity meter row)", () => {
		expect(eventsMeterItem("acct_1", 0)).toBeUndefined();
	});

	test("a positive count produces a webhook.event item", () => {
		const item = eventsMeterItem("acct_1", 12);
		expect(item?.unit).toBe("webhook.event");
		expect(item?.quantity).toBe(12);
		expect(item?.accountId).toBe("acct_1");
	});
});

describe("sampleMemoryGbHour / sampleStorageGbDay", () => {
	test("memory: 2 GiB for a 60s interval → 2/60 GB-hour", async () => {
		const item = await sampleMemoryGbHour(
			"acct_1",
			async () => 2 * 1024 ** 3,
			60,
		);
		expect(item.unit).toBe("memory.gb_hour");
		expect(item.quantity).toBeCloseTo(2 / 60, 6);
	});

	test("storage: bytes converted to GB", async () => {
		const item = await sampleStorageGbDay("acct_1", async () => 5 * 1024 ** 3);
		expect(item.unit).toBe("storage.gb_day");
		expect(item.quantity).toBeCloseTo(5, 6);
	});
});

describe("flushMeterBatch", () => {
	test("an empty batch never calls fetch", async () => {
		let called = false;
		await flushMeterBatch(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () => {
					called = true;
					return new Response("{}", { status: 200 });
				},
			},
			[],
		);
		expect(called).toBe(false);
	});

	test("sends items with the workload host key, throws on a non-2xx response", async () => {
		let seenBody: unknown;
		await flushMeterBatch(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async (_url, init) => {
					seenBody = JSON.parse(String(init?.body));
					return new Response("{}", { status: 200 });
				},
			},
			[
				{
					accountId: "acct_1",
					unit: "webhook.event",
					quantity: 3,
					idempotencyKey: "evt:acct_1:2026-09-25T14:37",
				},
			],
		);
		expect(seenBody).toEqual({
			items: [
				{
					accountId: "acct_1",
					unit: "webhook.event",
					quantity: 3,
					idempotencyKey: "evt:acct_1:2026-09-25T14:37",
				},
			],
		});

		await expect(
			flushMeterBatch(
				{
					appServerUrl: "https://api.secondlayer.tools",
					workloadHostKey: "wh-key",
					fetchImpl: async () => new Response("nope", { status: 401 }),
				},
				[
					{
						accountId: "acct_1",
						unit: "webhook.event",
						quantity: 1,
						idempotencyKey: "k1",
					},
				],
			),
		).rejects.toThrow(/meters flush failed: 401/);
	});
});

describe("flushAll", () => {
	test("pages items at maxBatch and keeps going after one page fails", async () => {
		const calls: number[] = [];
		let failNext = true;
		await flushAll(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async (_url, init) => {
					const body = JSON.parse(String(init?.body)) as { items: unknown[] };
					calls.push(body.items.length);
					if (failNext) {
						failNext = false;
						return new Response("boom", { status: 500 });
					}
					return new Response("{}", { status: 200 });
				},
			},
			Array.from({ length: 5 }, (_, i) => ({
				accountId: "acct_1",
				unit: "webhook.event" as const,
				quantity: 1,
				idempotencyKey: `k${i}`,
			})),
			2,
		);
		expect(calls).toEqual([2, 2, 1]); // 3 pages of size 2,2,1; all attempted despite the first failing
	});
});

describe("startMeterSocketServer", () => {
	test("a POST with delivered_events adds to the counter over the real unix socket", async () => {
		const dir = tmpdir();
		const socketPath = join(
			dir,
			`workload-meter-test-${crypto.randomUUID()}.sock`,
		);
		const counter = new EventCounter();
		const handle = startMeterSocketServer(socketPath, counter);
		try {
			expect(existsSync(socketPath)).toBe(true);
			const res = await fetch("http://localhost/", {
				method: "POST",
				body: JSON.stringify({ delivered_events: 4 }),
				unix: socketPath,
			});
			expect(res.status).toBe(200);
			expect(counter.drain()).toBe(4);
		} finally {
			handle.stop();
		}
	});

	test("a GET is rejected with 405, never counted", async () => {
		const socketPath = join(
			tmpdir(),
			`workload-meter-test-${crypto.randomUUID()}.sock`,
		);
		const counter = new EventCounter();
		const handle = startMeterSocketServer(socketPath, counter);
		try {
			const res = await fetch("http://localhost/", {
				method: "GET",
				unix: socketPath,
			});
			expect(res.status).toBe(405);
			expect(counter.drain()).toBe(0);
		} finally {
			handle.stop();
		}
	});
});
