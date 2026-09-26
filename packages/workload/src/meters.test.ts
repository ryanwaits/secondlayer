import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EventCounter,
	collectShutdownFlushItems,
	eventsIdempotencyKey,
	eventsMeterItem,
	flushAll,
	flushMeterBatch,
	flushOnShutdown,
	memoryIdempotencyKey,
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
		const { items, droppedCount } = mergePending(pending, fresh, 5);
		expect(droppedCount).toBe(2);
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
	test("drains each EventCounter and the memory accumulator, ahead of every pending buffer", () => {
		const counterA = new EventCounter();
		counterA.add(5);
		const counterB = new EventCounter();
		counterB.add(2);

		const state = {
			eventCounters: new Map([
				["acct_a", counterA],
				["acct_b", counterB],
			]),
			eventPending: [
				{
					accountId: "acct_a",
					unit: "webhook.event" as const,
					quantity: 1,
					idempotencyKey: "evt:acct_a:pending",
				},
			],
			memoryAccumulatorGbHours: new Map([
				["acct_a", 1.5],
				["acct_zero", 0],
			]),
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

		const items = collectShutdownFlushItems(state);

		// Pending (already-retried) items come first, in buffer order.
		expect(items[0]?.idempotencyKey).toBe("evt:acct_a:pending");
		expect(items[1]?.idempotencyKey).toBe("mem:acct_a:pending");
		expect(items[2]?.idempotencyKey).toBe("storage:acct_a:pending");

		const eventItems = items.filter((i) => i.unit === "webhook.event");
		expect(eventItems).toContainEqual(
			expect.objectContaining({ accountId: "acct_a", quantity: 5 }),
		);
		expect(eventItems).toContainEqual(
			expect.objectContaining({ accountId: "acct_b", quantity: 2 }),
		);

		const memoryItems = items.filter(
			(i) =>
				i.unit === "memory.gb_hour" &&
				i.idempotencyKey !== "mem:acct_a:pending",
		);
		expect(memoryItems).toEqual([
			expect.objectContaining({ accountId: "acct_a", quantity: 1.5 }),
		]);

		// acct_zero had a non-positive accumulator — never a zero-quantity row.
		expect(items.some((i) => i.accountId === "acct_zero")).toBe(false);

		// Both live counters are drained, and the memory accumulator is cleared,
		// exactly like the periodic loops do — a second call finds nothing left.
		expect(counterA.drain()).toBe(0);
		expect(counterB.drain()).toBe(0);
		expect(state.memoryAccumulatorGbHours.size).toBe(0);
	});

	test("no live state and empty pending buffers produces an empty list", () => {
		const items = collectShutdownFlushItems({
			eventCounters: new Map(),
			eventPending: [],
			memoryAccumulatorGbHours: new Map(),
			memoryPending: [],
			storagePending: [],
		});
		expect(items).toEqual([]);
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
