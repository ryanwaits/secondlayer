import { describe, expect, it } from "bun:test";
import { scheduleCron, settleInFlightTicks } from "./cron-schedule.ts";

describe("cron schedule", () => {
	it("waits for a running tick to finish before shutdown continues", async () => {
		let finished = false;
		const stop = scheduleCron(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 60));
				finished = true;
			},
			1,
			60_000,
		);
		await new Promise((resolve) => setTimeout(resolve, 15));
		stop();

		expect(await settleInFlightTicks(1000)).toBe(0);
		expect(finished).toBe(true);
	});

	it("gives up on a tick that never settles once the bound passes", async () => {
		const stop = scheduleCron(() => new Promise<void>(() => {}), 1, 60_000);
		await new Promise((resolve) => setTimeout(resolve, 15));
		stop();

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
