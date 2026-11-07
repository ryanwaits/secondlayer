import { describe, expect, test } from "bun:test";
import { skipWhileRunning } from "./tick-guard.ts";

describe("skipWhileRunning", () => {
	test("a tick that fires while the previous one runs is skipped", async () => {
		let runs = 0;
		let skips = 0;
		let release = () => {};
		const tick = skipWhileRunning(
			async () => {
				runs++;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			},
			() => skips++,
		);

		const first = tick();
		await tick();
		await tick();
		expect(runs).toBe(1);
		expect(skips).toBe(2);

		release();
		await first;
	});

	test("runs again once the previous tick finished, even when it threw", async () => {
		let runs = 0;
		const tick = skipWhileRunning(async () => {
			runs++;
			throw new Error("round failed");
		});

		await expect(tick()).rejects.toThrow("round failed");
		await expect(tick()).rejects.toThrow("round failed");
		expect(runs).toBe(2);
	});
});
