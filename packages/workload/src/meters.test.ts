import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PRICES,
	stackMemoryFloorGb,
} from "@secondlayer/platform/billing/prices";
import {
	DrainWindow,
	EventCounter,
	MemoryAccumulator,
	collectShutdownFlushItems,
	countTenantWorkloads,
	createMeterSocketRegistry,
	eventsMeterItem,
	eventsWindowKey,
	flushAll,
	flushMeterBatch,
	flushOnShutdown,
	logDroppedMeters,
	memoryWindowKey,
	mergePending,
	parseDockerStatsMemUsageBytes,
	parseMemUsageToBytes,
	parsePgDatabaseSizeOutput,
	sampleMemoryGbHour,
	sampleStorageGbDay,
	sampleTenantDatabaseBytes,
	sampleTenantMemoryBytes,
	startMeterSocketServer,
	storageIdempotencyKey,
} from "./meters.ts";

describe("idempotency key shapes", () => {
	const at = new Date("2026-09-25T14:37:12.000Z");
	const window = {
		start: new Date("2026-09-25T14:05:03.123Z"),
		end: new Date("2026-09-25T15:00:00.000Z"),
	};

	test("memory: mem:<account>:<startISO>..<endISO>", () => {
		expect(memoryWindowKey("acct_1", window)).toBe(
			"mem:acct_1:2026-09-25T14:05:03.123Z..2026-09-25T15:00:00.000Z",
		);
	});

	test("storage: storage:<account>:<yyyy-mm-dd>", () => {
		expect(storageIdempotencyKey("acct_1", at)).toBe(
			"storage:acct_1:2026-09-25",
		);
	});

	test("events: evt:<account>:<startISO>..<endISO>", () => {
		expect(eventsWindowKey("acct_1", window)).toBe(
			"evt:acct_1:2026-09-25T14:05:03.123Z..2026-09-25T15:00:00.000Z",
		);
	});

	test("a window key never equals the hour-shaped key an older process wrote for the same hour", () => {
		const oldHourKey = "mem:acct_1:2026-09-25T14";
		expect(memoryWindowKey("acct_1", window)).not.toBe(oldHourKey);
		expect(memoryWindowKey("acct_1", window)).toContain("..");
	});
});

describe("DrainWindow", () => {
	test("consecutive windows tile: each starts where the previous ended", () => {
		const boot = new Date("2026-09-25T14:05:03.123Z");
		const w = new DrainWindow(boot);
		const first = w.roll(new Date("2026-09-25T15:00:00.000Z"));
		const second = w.roll(new Date("2026-09-25T16:00:00.000Z"));
		expect(first.start).toEqual(boot);
		expect(second.start).toEqual(first.end);
	});

	test("a clock that steps backwards never produces a window that ends before it starts", () => {
		const boot = new Date("2026-09-25T14:05:00.000Z");
		const w = new DrainWindow(boot);
		const window = w.roll(new Date("2026-09-25T14:00:00.000Z"));
		expect(window.end).toEqual(boot);
	});
});

describe("MemoryAccumulator", () => {
	test("a restart in the same hour bills both halves under different keys", () => {
		// Process A: boots 14:05, flushes hourly at 15:00 and drains at a
		// 15:20 shutdown. Process B boots 15:21 and flushes at 16:00.
		const a = new MemoryAccumulator(new Date("2026-09-25T14:05:00.000Z"));
		a.add("acct_1", 0.5, 0.4);
		const hourly = a.drain(new Date("2026-09-25T15:00:00.000Z"));
		a.add("acct_1", 0.25, 0.2);
		const shutdown = a.drain(new Date("2026-09-25T15:20:00.000Z"));

		const b = new MemoryAccumulator(new Date("2026-09-25T15:21:00.000Z"));
		b.add("acct_1", 0.75, 0.6);
		const afterRestart = b.drain(new Date("2026-09-25T16:00:00.000Z"));

		const all = [...hourly, ...shutdown, ...afterRestart];
		const keys = all.map((i) => i.idempotencyKey);
		expect(new Set(keys).size).toBe(3);
		expect(all.map((i) => i.quantity)).toEqual([0.5, 0.25, 0.75]);
		expect(all.reduce((sum, i) => sum + i.quantity, 0)).toBe(1.5);
	});

	test("drain dates each item at its window end and carries the observed total", () => {
		const acc = new MemoryAccumulator(new Date("2026-09-25T14:00:00.000Z"));
		acc.add("acct_1", 0.1, 0.05);
		acc.add("acct_1", 0.2, 0.15);
		const [item] = acc.drain(new Date("2026-09-25T15:00:00.000Z"));
		expect(item?.quantity).toBeCloseTo(0.3, 9);
		expect(item?.observedQuantity).toBeCloseTo(0.2, 9);
		expect(item?.occurredAt).toBe("2026-09-25T15:00:00.000Z");
	});

	test("an empty or zero accumulator drains nothing and still advances the window", () => {
		const acc = new MemoryAccumulator(new Date("2026-09-25T14:00:00.000Z"));
		acc.add("acct_zero", 0, 0);
		expect(acc.drain(new Date("2026-09-25T15:00:00.000Z"))).toEqual([]);
		acc.add("acct_1", 1, 1);
		const [item] = acc.drain(new Date("2026-09-25T16:00:00.000Z"));
		expect(item?.idempotencyKey).toBe(
			"mem:acct_1:2026-09-25T15:00:00.000Z..2026-09-25T16:00:00.000Z",
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
	const window = {
		start: new Date("2026-09-25T22:06:00.000Z"),
		end: new Date("2026-09-25T22:07:00.000Z"),
	};

	test("zero count produces no item (never a zero-quantity meter row)", () => {
		expect(eventsMeterItem("acct_1", 0, window)).toBeUndefined();
	});

	test("a positive count produces a webhook.event item keyed and dated by its window", () => {
		const item = eventsMeterItem("acct_1", 12, window);
		expect(item?.unit).toBe("webhook.event");
		expect(item?.quantity).toBe(12);
		expect(item?.accountId).toBe("acct_1");
		expect(item?.idempotencyKey).toBe(eventsWindowKey("acct_1", window));
		expect(item?.occurredAt).toBe("2026-09-25T22:07:00.000Z");
	});

	test("a flush then a shutdown drain in the same minute bill both counts", () => {
		const counter = new EventCounter();
		const w = new DrainWindow(new Date("2026-09-25T22:06:00.000Z"));
		counter.add(10);
		const tick = eventsMeterItem(
			"acct_1",
			counter.drain(),
			w.roll(new Date("2026-09-25T22:06:20.000Z")),
		);
		counter.add(4);
		const shutdown = eventsMeterItem(
			"acct_1",
			counter.drain(),
			w.roll(new Date("2026-09-25T22:06:50.000Z")),
		);
		expect(tick?.idempotencyKey).not.toBe(shutdown?.idempotencyKey);
		expect((tick?.quantity ?? 0) + (shutdown?.quantity ?? 0)).toBe(14);
	});
});

describe("sampleMemoryGbHour / sampleStorageGbDay", () => {
	test("memory: 2 GiB for a 60s interval → 2/60 GB-hour", async () => {
		const item = await sampleMemoryGbHour(
			"acct_1",
			async () => 2 * 1024 ** 3,
			60,
			false,
		);
		expect(item.quantity).toBeCloseTo(2 / 60, 6);
	});

	test("storage: bytes converted to GB", async () => {
		const item = await sampleStorageGbDay("acct_1", async () => 5 * 1024 ** 3);
		expect(item.unit).toBe("storage.gb_day");
		expect(item.quantity).toBeCloseTo(5, 6);
	});

	test("a webhook-only stack idling at 100 MB bills the $5/mo floor", async () => {
		const item = await sampleMemoryGbHour(
			"acct_1",
			async () => 100 * 1024 ** 2,
			3600,
			false,
		);
		expect(item.quantity).toBeCloseTo(stackMemoryFloorGb(false), 6);
		// One hour at the floor: 6,849 µ$, which is $5.00 over 730 hours.
		expect(Math.round(Number(PRICES["memory.gb_hour"]) * item.quantity)).toBe(
			6_849,
		);
		// observedQuantity carries the raw, unfloored sample (~0.098 GB-h).
		expect(item.observedQuantity).toBeCloseTo(0.09765625, 6);
	});

	test("a stack with subgraphs idling at 100 MB bills the $10/mo floor", async () => {
		const item = await sampleMemoryGbHour(
			"acct_1",
			async () => 100 * 1024 ** 2,
			3600,
			true,
		);
		expect(item.quantity).toBeCloseTo(stackMemoryFloorGb(true), 6);
		expect(item.observedQuantity).toBeCloseTo(0.09765625, 6);
	});

	test("a webhook-only stack at 0.4 GB bills its real 0.4 GB", async () => {
		const item = await sampleMemoryGbHour(
			"acct_1",
			async () => 0.4 * 1024 ** 3,
			3600,
			false,
		);
		expect(item.quantity).toBeCloseTo(0.4, 6);
		expect(item.observedQuantity).toBeCloseTo(0.4, 6);
	});

	test("memory: a 2 GB sample bills the raw sample, above the floor", async () => {
		const item = await sampleMemoryGbHour(
			"acct_1",
			async () => 2 * 1024 ** 3,
			3600,
			false,
		);
		expect(item.quantity).toBeCloseTo(2, 6);
		// Above the floor, observedQuantity equals the billed quantity.
		expect(item.observedQuantity).toBeCloseTo(2, 6);
	});

	test("storage: occurredAt is pinned to the sample time", async () => {
		const before = Date.now();
		const item = await sampleStorageGbDay("acct_1", async () => 5 * 1024 ** 3);
		const after = Date.now();
		expect(item.occurredAt).toBeDefined();
		const occurredAtMs = Date.parse(item.occurredAt as string);
		expect(occurredAtMs).toBeGreaterThanOrEqual(before);
		expect(occurredAtMs).toBeLessThanOrEqual(after);
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
		const allItems = Array.from({ length: 5 }, (_, i) => ({
			accountId: "acct_1",
			unit: "webhook.event" as const,
			quantity: 1,
			idempotencyKey: `k${i}`,
		}));
		const failed = await flushAll(
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
			allItems,
			2,
		);
		expect(calls).toEqual([2, 2, 1]); // 3 pages of size 2,2,1; all attempted despite the first failing
		expect(failed).toEqual(allItems.slice(0, 2)); // exactly the first (failed) page, returned unchanged
	});

	test("returns an empty array when every page sends successfully", async () => {
		const failed = await flushAll(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () => new Response("{}", { status: 200 }),
			},
			Array.from({ length: 4 }, (_, i) => ({
				accountId: "acct_1",
				unit: "webhook.event" as const,
				quantity: 1,
				idempotencyKey: `k${i}`,
			})),
			2,
		);
		expect(failed).toEqual([]);
	});

	test("a retried (resent) item keeps its original occurredAt — flushAll never rebuilds items", async () => {
		const sampledAt = "2026-09-25T22:00:00.000Z"; // a real hour a retry must not overwrite
		const item = {
			accountId: "acct_1",
			unit: "memory.gb_hour" as const,
			quantity: 0.5,
			idempotencyKey: "mem:acct_1:2026-09-25T22",
			occurredAt: sampledAt,
		};
		const failed = await flushAll(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () => new Response("boom", { status: 500 }),
			},
			[item],
			10,
		);
		// Byte-identical on the way back out — a later resend still carries the
		// original sample time, not whenever the resend happens to run.
		expect(failed).toEqual([item]);
		expect(failed[0]?.occurredAt).toBe(sampledAt);
	});

	test("a retried events item (built by eventsMeterItem at drain time) keeps its original occurredAt", async () => {
		const item = eventsMeterItem("acct_1", 40, {
			start: new Date("2026-09-25T22:06:00.000Z"),
			end: new Date("2026-09-25T22:07:00.000Z"),
		});
		if (!item) throw new Error("expected an item for a positive count");

		const failed = await flushAll(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () => new Response("boom", { status: 500 }),
			},
			[item],
			10,
		);
		// Same guarantee as memory: a later resend of this exact (unchanged)
		// item still carries the minute it was actually drained in, not
		// whenever the resend happens to run.
		expect(failed).toEqual([item]);
		expect(failed[0]?.occurredAt).toBe("2026-09-25T22:07:00.000Z");
	});
});

describe("mergePending", () => {
	test("orders pending (retried) items ahead of freshly-sampled ones", () => {
		const pending = [
			{
				accountId: "acct_1",
				unit: "webhook.event" as const,
				quantity: 1,
				idempotencyKey: "evt:acct_1:2026-09-25T14:37",
			},
		];
		const fresh = [
			{
				accountId: "acct_1",
				unit: "webhook.event" as const,
				quantity: 1,
				idempotencyKey: "evt:acct_1:2026-09-25T14:38",
			},
		];
		const { items, droppedCount } = mergePending(pending, fresh, 10);
		expect(items).toEqual([...pending, ...fresh]);
		expect(droppedCount).toBe(0);
	});

	test("a retried item keeps its original idempotency key across ticks, even though a fresh sample in a different minute gets a different key", () => {
		const retried = {
			accountId: "acct_1",
			unit: "webhook.event" as const,
			quantity: 3,
			idempotencyKey: "evt:acct_1:2026-09-25T14:37",
		};
		const freshSameAccount = {
			accountId: "acct_1",
			unit: "webhook.event" as const,
			quantity: 5,
			idempotencyKey: "evt:acct_1:2026-09-25T14:38",
		};
		const { items } = mergePending([retried], [freshSameAccount], 10);
		expect(items[0]).toBe(retried); // same object, not rebuilt — key untouched
		expect(items[0]?.idempotencyKey).toBe("evt:acct_1:2026-09-25T14:37");
		expect(items[1]?.idempotencyKey).toBe("evt:acct_1:2026-09-25T14:38");
	});

	test("over the cap, drops the OLDEST items and reports how many", () => {
		const pending = Array.from({ length: 3 }, (_, i) => ({
			accountId: "acct_1",
			unit: "webhook.event" as const,
			quantity: 1,
			idempotencyKey: `old${i}`,
		}));
		const fresh = Array.from({ length: 4 }, (_, i) => ({
			accountId: "acct_1",
			unit: "webhook.event" as const,
			quantity: 1,
			idempotencyKey: `new${i}`,
		}));
		const { items, droppedCount, dropped } = mergePending(pending, fresh, 5);
		expect(droppedCount).toBe(2);
		expect(dropped.map((i) => i.idempotencyKey)).toEqual(["old0", "old1"]);
		// the 2 oldest pending items are gone; everything else survives in order
		expect(items.map((i) => i.idempotencyKey)).toEqual([
			"old2",
			"new0",
			"new1",
			"new2",
			"new3",
		]);
	});

	test("under the cap, nothing is dropped", () => {
		const { items, droppedCount } = mergePending([], [], 10);
		expect(items).toEqual([]);
		expect(droppedCount).toBe(0);
	});
});

describe("collectShutdownFlushItems", () => {
	const boot = new Date("2026-09-25T14:05:00.000Z");
	const shutdownAt = new Date("2026-09-25T14:40:00.000Z");

	test("drains each EventCounter and the memory accumulator, behind every pending buffer", () => {
		const counterA = new EventCounter();
		counterA.add(5);
		const counterB = new EventCounter();
		counterB.add(2);
		const memory = new MemoryAccumulator(boot);
		memory.add("acct_a", 1.5, 1.2);
		memory.add("acct_zero", 0, 0);

		const state = {
			eventCounters: new Map([
				["acct_a", counterA],
				["acct_b", counterB],
			]),
			eventWindow: new DrainWindow(boot),
			eventPending: [
				{
					accountId: "acct_a",
					unit: "webhook.event" as const,
					quantity: 1,
					idempotencyKey: "evt:acct_a:pending",
				},
			],
			memory,
			memoryPending: [
				{
					accountId: "acct_a",
					unit: "memory.gb_hour" as const,
					quantity: 0.25,
					idempotencyKey: "mem:acct_a:pending",
				},
			],
			storagePending: [
				{
					accountId: "acct_a",
					unit: "storage.gb_day" as const,
					quantity: 3,
					idempotencyKey: "storage:acct_a:pending",
				},
			],
		};

		const items = collectShutdownFlushItems(state, shutdownAt);

		// Pending (already-retried) items come first, in buffer order.
		expect(items[0]?.idempotencyKey).toBe("evt:acct_a:pending");
		expect(items[1]?.idempotencyKey).toBe("mem:acct_a:pending");
		expect(items[2]?.idempotencyKey).toBe("storage:acct_a:pending");

		const eventItems = items.filter(
			(i) => i.unit === "webhook.event" && i.idempotencyKey.includes(".."),
		);
		expect(eventItems).toContainEqual(
			expect.objectContaining({ accountId: "acct_a", quantity: 5 }),
		);
		expect(eventItems).toContainEqual(
			expect.objectContaining({ accountId: "acct_b", quantity: 2 }),
		);

		const memoryItems = items.filter(
			(i) => i.unit === "memory.gb_hour" && i.idempotencyKey.includes(".."),
		);
		expect(memoryItems).toEqual([
			expect.objectContaining({ accountId: "acct_a", quantity: 1.5 }),
		]);

		// acct_zero had a non-positive accumulator: never a zero-quantity row.
		expect(items.some((i) => i.accountId === "acct_zero")).toBe(false);

		// Live state is drained: a second call finds nothing left.
		expect(counterA.drain()).toBe(0);
		expect(counterB.drain()).toBe(0);
		expect(memory.drain(shutdownAt)).toEqual([]);
	});

	test("no live state and empty pending buffers produces an empty list", () => {
		const items = collectShutdownFlushItems(
			{
				eventCounters: new Map(),
				eventWindow: new DrainWindow(boot),
				eventPending: [],
				memory: new MemoryAccumulator(boot),
				memoryPending: [],
				storagePending: [],
			},
			shutdownAt,
		);
		expect(items).toEqual([]);
	});

	test("freshly-drained items share one shutdown instant as their window end and date", () => {
		const counter = new EventCounter();
		counter.add(3);
		const memory = new MemoryAccumulator(boot);
		memory.add("acct_a", 1.5, 1.2);

		const items = collectShutdownFlushItems(
			{
				eventCounters: new Map([["acct_a", counter]]),
				eventWindow: new DrainWindow(boot),
				eventPending: [],
				memory,
				memoryPending: [],
				storagePending: [],
			},
			shutdownAt,
		);

		expect(items).toHaveLength(2);
		for (const item of items) {
			expect(item.occurredAt).toBe(shutdownAt.toISOString());
			expect(
				item.idempotencyKey.endsWith(`..${shutdownAt.toISOString()}`),
			).toBe(true);
		}
	});

	test("a shutdown in the same hour as the last hourly flush does not reuse its key", () => {
		const memory = new MemoryAccumulator(boot);
		memory.add("acct_a", 1, 1);
		const hourly = memory.drain(new Date("2026-09-25T14:30:00.000Z"));
		memory.add("acct_a", 0.5, 0.5);
		const items = collectShutdownFlushItems(
			{
				eventCounters: new Map(),
				eventWindow: new DrainWindow(boot),
				eventPending: [],
				memory,
				memoryPending: [],
				storagePending: [],
			},
			shutdownAt,
		);
		expect(items).toHaveLength(1);
		expect(items[0]?.idempotencyKey).not.toBe(hourly[0]?.idempotencyKey);
		expect(items[0]?.quantity).toBe(0.5);
	});

	test("already-pending items (from an earlier failed flush) pass through with whatever occurredAt they already carried", () => {
		const items = collectShutdownFlushItems(
			{
				eventCounters: new Map(),
				eventWindow: new DrainWindow(boot),
				eventPending: [
					{
						accountId: "acct_a",
						unit: "webhook.event" as const,
						quantity: 1,
						idempotencyKey: "evt:acct_a:pending",
						occurredAt: "2026-09-25T22:00:00.000Z",
					},
				],
				memory: new MemoryAccumulator(boot),
				memoryPending: [
					{
						accountId: "acct_a",
						unit: "memory.gb_hour" as const,
						quantity: 0.25,
						idempotencyKey: "mem:acct_a:pending",
						occurredAt: "2026-09-25T23:00:00.000Z",
					},
				],
				storagePending: [],
			},
			shutdownAt,
		);
		expect(items[0]?.occurredAt).toBe("2026-09-25T22:00:00.000Z");
		expect(items[1]?.occurredAt).toBe("2026-09-25T23:00:00.000Z");
	});
});

describe("logDroppedMeters", () => {
	test("sums dropped quantities per unit and logs nothing for an empty list", () => {
		const logged: unknown[] = [];
		const orig = console.error;
		console.error = (...args: unknown[]) => {
			logged.push(args);
		};
		try {
			logDroppedMeters("pending_overflow:events", []);
			expect(logged).toHaveLength(0);
			logDroppedMeters("pending_overflow:memory", [
				{
					accountId: "acct_a",
					unit: "memory.gb_hour",
					quantity: 0.5,
					idempotencyKey: "k1",
				},
				{
					accountId: "acct_a",
					unit: "memory.gb_hour",
					quantity: 0.25,
					idempotencyKey: "k2",
				},
			]);
		} finally {
			console.error = orig;
		}
		const text = JSON.stringify(logged);
		expect(text).toContain("meter.dropped");
		expect(text).toContain("0.75");
	});
});

describe("flushOnShutdown", () => {
	test("sends the accumulated items exactly once with the expected idempotency keys", async () => {
		const seenBatches: unknown[] = [];
		await flushOnShutdown(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async (_url, init) => {
					seenBatches.push(JSON.parse(String(init?.body)));
					return new Response("{}", { status: 200 });
				},
			},
			[
				{
					accountId: "acct_a",
					unit: "memory.gb_hour",
					quantity: 1.5,
					idempotencyKey: "mem:acct_a:2026-09-26T10",
				},
			],
			100,
			5_000,
		);
		expect(seenBatches).toEqual([
			{
				items: [
					{
						accountId: "acct_a",
						unit: "memory.gb_hour",
						quantity: 1.5,
						idempotencyKey: "mem:acct_a:2026-09-26T10",
					},
				],
			},
		]);
	});

	test("an empty item list never calls fetch", async () => {
		let called = false;
		await flushOnShutdown(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () => {
					called = true;
					return new Response("{}", { status: 200 });
				},
			},
			[],
			100,
			5_000,
		);
		expect(called).toBe(false);
	});

	test("a flush that hangs past the timeout still resolves (never blocks process exit)", async () => {
		const start = Date.now();
		await flushOnShutdown(
			{
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: () => new Promise(() => {}), // never resolves
			},
			[
				{
					accountId: "acct_a",
					unit: "webhook.event",
					quantity: 1,
					idempotencyKey: "evt:acct_a:hang",
				},
			],
			100,
			200,
		);
		expect(Date.now() - start).toBeLessThan(1_000);
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

describe("parseMemUsageToBytes (review fix 4)", () => {
	test("parses MiB", () => {
		expect(parseMemUsageToBytes("239.3MiB")).toBeCloseTo(239.3 * 1024 ** 2, 0);
	});

	test("parses GiB", () => {
		expect(parseMemUsageToBytes("1.2GiB")).toBeCloseTo(1.2 * 1024 ** 3, 0);
	});

	test("parses a bare number with a space before the unit", () => {
		expect(parseMemUsageToBytes("42.45 MiB")).toBeCloseTo(42.45 * 1024 ** 2, 0);
	});

	test("unparseable input returns 0, never throws", () => {
		expect(parseMemUsageToBytes("garbage")).toBe(0);
		expect(parseMemUsageToBytes("")).toBe(0);
	});
});

describe("parseDockerStatsMemUsageBytes (review fix 4)", () => {
	test("sums MemUsage across multiple container lines, using only the used side", () => {
		// Real `docker stats --format {{.MemUsage}}` output for a tenant's three
		// containers (captured shape from the step-3 local verify).
		const output = [
			"42.45MiB / 15.66GiB",
			"239.3MiB / 15.66GiB",
			"133MiB / 15.66GiB",
		].join("\n");
		const bytes = parseDockerStatsMemUsageBytes(output);
		const expected = (42.45 + 239.3 + 133) * 1024 ** 2;
		expect(bytes).toBeCloseTo(expected, -3); // within ~1KB of the sum
	});

	test("blank lines are skipped", () => {
		const output = "42.45MiB / 15.66GiB\n\n\n";
		expect(parseDockerStatsMemUsageBytes(output)).toBeCloseTo(
			42.45 * 1024 ** 2,
			0,
		);
	});

	test("empty output is 0 bytes, not an error", () => {
		expect(parseDockerStatsMemUsageBytes("")).toBe(0);
	});
});

describe("parsePgDatabaseSizeOutput (review fix 4)", () => {
	test("parses a bare integer with trailing whitespace/newline", () => {
		expect(parsePgDatabaseSizeOutput(" 8404992\n")).toBe(8404992);
	});

	test("unparseable output is 0, not NaN", () => {
		expect(parsePgDatabaseSizeOutput("ERROR: relation does not exist")).toBe(0);
	});
});

describe("sampleTenantMemoryBytes (review fix 4)", () => {
	test("docker ps by compose-project label, then docker stats on exactly those ids", async () => {
		const calls: string[][] = [];
		const runDocker = async (args: string[]) => {
			calls.push(args);
			if (args[0] === "ps") {
				return { code: 0, stdout: "abc123\ndef456\n", stderr: "" };
			}
			return { code: 0, stdout: "100MiB / 8GiB\n200MiB / 8GiB\n", stderr: "" };
		};
		const bytes = await sampleTenantMemoryBytes("acct1234", runDocker);
		expect(bytes).toBeCloseTo(300 * 1024 ** 2, 0);

		expect(calls[0]).toEqual([
			"ps",
			"-q",
			"--filter",
			"label=com.docker.compose.project=tenant-acct1234",
		]);
		expect(calls[1]).toEqual([
			"stats",
			"--no-stream",
			"--format",
			"{{.MemUsage}}",
			"abc123",
			"def456",
		]);
	});

	test("zero containers → 0 bytes, docker stats is never called", async () => {
		let statsCalled = false;
		const runDocker = async (args: string[]) => {
			if (args[0] === "stats") statsCalled = true;
			return { code: 0, stdout: "", stderr: "" };
		};
		expect(await sampleTenantMemoryBytes("acct1234", runDocker)).toBe(0);
		expect(statsCalled).toBe(false);
	});
});

describe("sampleTenantDatabaseBytes (review fix 4)", () => {
	test("execs psql in the tenant's own postgres container", async () => {
		let seenArgs: string[] = [];
		const runDocker = async (args: string[]) => {
			seenArgs = args;
			return { code: 0, stdout: "1048576\n", stderr: "" };
		};
		const bytes = await sampleTenantDatabaseBytes("acct1234", runDocker);
		expect(bytes).toBe(1048576);
		expect(seenArgs[0]).toBe("exec");
		expect(seenArgs[1]).toBe("tenant-acct1234-postgres-1");
		expect(seenArgs).toContain("psql");
	});

	test("a non-zero exit → 0 bytes, not a thrown error", async () => {
		const runDocker = async () => ({
			code: 1,
			stdout: "",
			stderr: "no such container",
		});
		expect(await sampleTenantDatabaseBytes("acct1234", runDocker)).toBe(0);
	});
});

describe("countTenantWorkloads", () => {
	test("counts active webhooks plus subgraphs in the tenant's own postgres", async () => {
		let seenArgs: string[] = [];
		const runDocker = async (args: string[]) => {
			seenArgs = args;
			return { code: 0, stdout: "3\n", stderr: "" };
		};
		expect(await countTenantWorkloads("acct1234", runDocker)).toBe(3);
		expect(seenArgs[1]).toBe("tenant-acct1234-postgres-1");
		expect(seenArgs.at(-1)).toContain("status = 'active'");
	});

	test("a failed exec or garbled output is unreadable, never zero", async () => {
		const failed = async () => ({ code: 1, stdout: "", stderr: "down" });
		const garbled = async () => ({ code: 0, stdout: "ERROR", stderr: "" });
		const thrown = async (): Promise<never> => {
			throw new Error("docker missing");
		};
		expect(await countTenantWorkloads("acct1234", failed)).toBeNull();
		expect(await countTenantWorkloads("acct1234", garbled)).toBeNull();
		expect(await countTenantWorkloads("acct1234", thrown)).toBeNull();
	});
});

describe("createMeterSocketRegistry", () => {
	function setup() {
		const root = mkdtempSync(join(tmpdir(), "meter-registry-"));
		const socketPathFor = (accountId: string) =>
			join(root, accountId, "sockets", "meter.sock");
		const makeSocketDir = (accountId: string) =>
			mkdirSync(join(root, accountId, "sockets"), { recursive: true });
		return {
			socketPathFor,
			makeSocketDir,
			registry: createMeterSocketRegistry({ socketPathFor }),
		};
	}

	test("an idle running tenant gets a socket, and events pushed to it are billed", async () => {
		const { registry, makeSocketDir, socketPathFor } = setup();
		makeSocketDir("idle");
		try {
			registry.sync(["idle"]);
			expect(existsSync(socketPathFor("idle"))).toBe(true);
			const res = await fetch("http://localhost/", {
				method: "POST",
				body: JSON.stringify({ delivered_events: 7 }),
				unix: socketPathFor("idle"),
			});
			expect(res.status).toBe(200);
			const counter = registry.counters.get("idle");
			expect(counter).toBeDefined();
			const window = {
				start: new Date("2026-11-07T10:00:00Z"),
				end: new Date("2026-11-07T10:01:00Z"),
			};
			expect(
				eventsMeterItem("idle", (counter as EventCounter).drain(), window)
					?.quantity,
			).toBe(7);
		} finally {
			registry.stopAll();
		}
	});

	test("a failed server start is not cached: the next sync retries and succeeds", () => {
		const { registry, makeSocketDir, socketPathFor } = setup();
		try {
			// The tenant's socket dir does not exist yet (provisioning in flight).
			registry.sync(["late"]);
			expect(registry.counters.has("late")).toBe(false);
			expect(registry.gauge()).toEqual({ running: 1, servers: 0 });

			makeSocketDir("late");
			registry.sync(["late"]);
			expect(existsSync(socketPathFor("late"))).toBe(true);
			expect(registry.counters.has("late")).toBe(true);
			expect(registry.gauge()).toEqual({ running: 1, servers: 1 });
		} finally {
			registry.stopAll();
		}
	});

	test("a stale socket file from a previous process is replaced", async () => {
		const { registry, makeSocketDir, socketPathFor } = setup();
		makeSocketDir("stale");
		writeFileSync(socketPathFor("stale"), "");
		try {
			registry.sync(["stale"]);
			expect(registry.counters.has("stale")).toBe(true);
			const res = await fetch("http://localhost/", {
				method: "POST",
				body: JSON.stringify({ delivered_events: 1 }),
				unix: socketPathFor("stale"),
			});
			expect(res.status).toBe(200);
		} finally {
			registry.stopAll();
		}
	});

	test("ensure returns the same counter for a tenant it already serves", () => {
		const { registry, makeSocketDir } = setup();
		makeSocketDir("same");
		try {
			const first = registry.ensure("same");
			expect(first).toBeDefined();
			expect(registry.ensure("same")).toBe(first);
		} finally {
			registry.stopAll();
		}
	});
});
