import { describe, expect, test } from "bun:test";
import {
	type DiskSpace,
	DiskSpaceExhausted,
	waitForDiskSpace,
} from "./disk-guard.ts";

const GB = 1024 ** 3;

function harness(readings: number[]) {
	const pauses: number[] = [];
	let index = 0;
	const sleeps: number[] = [];
	return {
		pauses,
		sleeps,
		options: {
			path: "/",
			minFreeBytes: 100 * GB,
			pollMs: 60_000,
			maxWaitMs: 300_000,
			onPause: (space: DiskSpace) => pauses.push(space.freeBytes),
			sleep: async (ms: number) => {
				sleeps.push(ms);
			},
			readSpace: async () => ({
				// Repeat the last reading once exhausted, so a test can model
				// "space never returns".
				freeBytes: readings[Math.min(index++, readings.length - 1)] ?? 0,
				totalBytes: 873 * GB,
			}),
		},
	};
}

describe("disk guard", () => {
	test("proceeds immediately when there is headroom", async () => {
		const h = harness([200 * GB]);
		await waitForDiskSpace(h.options);
		expect(h.pauses).toHaveLength(0);
		expect(h.sleeps).toHaveLength(0);
	});

	test("waits out a transient spike rather than failing", async () => {
		// The nightly backup takes ~150GB for a while and then gives it back.
		// Dying here would abandon hours of work for a condition that resolves.
		const h = harness([20 * GB, 30 * GB, 200 * GB]);
		await waitForDiskSpace(h.options);
		expect(h.pauses).toHaveLength(2);
		expect(h.sleeps).toEqual([60_000, 60_000]);
	});

	test("gives up rather than pausing forever", async () => {
		// Space that never returns is a real problem, and an unattended job that
		// blocks indefinitely hides it.
		const h = harness([5 * GB]);
		expect(waitForDiskSpace(h.options)).rejects.toThrow(DiskSpaceExhausted);
	});

	test("the failure names both numbers an operator needs", async () => {
		const h = harness([5 * GB]);
		try {
			await waitForDiskSpace(h.options);
			throw new Error("should have thrown");
		} catch (err) {
			expect((err as Error).message).toContain("5.0GB free");
			expect((err as Error).message).toContain("need 100.0GB");
		}
	});

	test("treats exactly the threshold as sufficient", async () => {
		const h = harness([100 * GB]);
		await waitForDiskSpace(h.options);
		expect(h.pauses).toHaveLength(0);
	});
});
