import { describe, expect, test } from "bun:test";
import { stackMemoryFloorGb } from "@secondlayer/platform/billing/prices";
import type { TenantRow } from "./control-db.ts";
import {
	MEMORY_SAMPLE_CAP_MS,
	MEMORY_SAMPLE_INTERVAL_MS,
	createMemorySampleTick,
} from "./loops.ts";
import { MemoryAccumulator } from "./meters.ts";

const GIB = 1024 ** 3;

function tenant(accountId: string, hasSubgraphs = false): TenantRow {
	return { account_id: accountId, has_subgraphs: hasSubgraphs } as TenantRow;
}

function setup(clock: { at: number }, sampleBytes: () => Promise<number>) {
	const accumulator = new MemoryAccumulator(new Date(clock.at));
	const synced: string[][] = [];
	const tick = createMemorySampleTick({
		listRunning: async () => [tenant("acct-a")],
		sampleBytes,
		accumulator,
		onRunning: (ids) => synced.push([...ids]),
		now: () => new Date(clock.at),
	});
	const gbHours = () =>
		accumulator.drain(new Date(clock.at)).find((i) => i.accountId === "acct-a")
			?.quantity ?? 0;
	return { tick, gbHours, synced };
}

describe("memory sample tick", () => {
	test("overlapping ticks charge one sample, not two", async () => {
		const clock = { at: Date.parse("2026-11-07T10:00:00Z") };
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let sampleCalls = 0;
		const { tick, gbHours } = setup(clock, async () => {
			sampleCalls++;
			await gate;
			return 4 * GIB;
		});

		const first = tick();
		const second = tick();
		release();
		await Promise.all([first, second]);

		expect(sampleCalls).toBe(1);
		// First sample of a tenant has no previous sample: nominal interval.
		expect(gbHours()).toBeCloseTo(4 * (MEMORY_SAMPLE_INTERVAL_MS / 3_600_000));
	});

	test("charges the measured time since the tenant's last sample", async () => {
		const clock = { at: Date.parse("2026-11-07T10:00:00Z") };
		const { tick, gbHours } = setup(clock, async () => 4 * GIB);
		await tick();
		gbHours(); // drain the first sample

		clock.at += 90_000;
		await tick();
		expect(gbHours()).toBeCloseTo(4 * (90 / 3600));
	});

	test("a long gap is capped at five minutes", async () => {
		const clock = { at: Date.parse("2026-11-07T10:00:00Z") };
		const { tick, gbHours } = setup(clock, async () => 4 * GIB);
		await tick();
		gbHours();

		clock.at += 3 * 60 * 60_000;
		await tick();
		expect(gbHours()).toBeCloseTo(4 * (MEMORY_SAMPLE_CAP_MS / 3_600_000));
	});

	test("the stack floor still applies to the measured interval", async () => {
		const clock = { at: Date.parse("2026-11-07T10:00:00Z") };
		const { tick, gbHours } = setup(clock, async () => 0);
		await tick();
		gbHours();

		clock.at += 120_000;
		await tick();
		expect(gbHours()).toBeCloseTo(stackMemoryFloorGb(false) * (120 / 3600));
	});

	test("hands the running tenants to the socket sync every tick", async () => {
		const clock = { at: Date.parse("2026-11-07T10:00:00Z") };
		const { tick, synced } = setup(clock, async () => GIB);
		await tick();
		expect(synced).toEqual([["acct-a"]]);
	});
});
