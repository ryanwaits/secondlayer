import { afterEach, describe, expect, it } from "bun:test";
import {
	resetInFlightTicksForTests,
	scheduleCron,
	settleInFlightTicks,
} from "./cron-schedule.ts";

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!cond() && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("cron schedule", () => {
	afterEach(() => resetInFlightTicksForTests());

	it("waits for a running tick to finish before shutdown continues", async () => {
		let started = false;
		let finished = false;
		const stop = scheduleCron(
			async () => {
				started = true;
				await new Promise((resolve) => setTimeout(resolve, 60));
				finished = true;
			},
			1,
			60_000,
		);
		await waitFor(() => started);
		stop();

		expect(started).toBe(true);
		expect(await settleInFlightTicks(1000)).toBe(0);
		expect(finished).toBe(true);
	});

	it("gives up on a tick that never settles once the bound passes", async () => {
		let started = false;
		const stop = scheduleCron(
			() => {
				started = true;
				return new Promise<void>(() => {});
			},
			1,
			60_000,
		);
		await waitFor(() => started);
		stop();

		expect(started).toBe(true);
		expect(await settleInFlightTicks(30)).toBe(1);
	});

	it("a stopped schedule runs no further ticks", async () => {
		let runs = 0;
		const stop = scheduleCron(
			async () => {
				runs++;
			},
			5,
			5,
		);
		stop();
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(runs).toBe(0);
	});
});
