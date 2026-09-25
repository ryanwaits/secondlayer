import { describe, expect, test } from "bun:test";
import { createWakeBus, notify } from "./listener.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const CHANNEL = "wake_bus_test_channel";

describe.skipIf(!HAS_DB)("createWakeBus", () => {
	test("every waiter resolves on the next NOTIFY, and gets a fresh promise after", async () => {
		const bus = await createWakeBus(CHANNEL);
		try {
			const first = bus.wait();
			const second = bus.wait();
			await notify(CHANNEL);
			await Promise.all([first, second]);

			// A resolved waiter's slot is gone; a NEW wait() must not resolve until
			// the NEXT notify, proving waiters don't leak across notifications.
			let resolvedEarly = false;
			const third = bus.wait().then(() => {
				resolvedEarly = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(resolvedEarly).toBe(false);

			await notify(CHANNEL);
			await third;
			expect(resolvedEarly).toBe(true);
		} finally {
			await bus.stop();
		}
	});

	test("stop() resolves every pending waiter instead of leaving it hanging", async () => {
		const bus = await createWakeBus(CHANNEL);
		const pending = bus.wait();
		await bus.stop();
		// Must resolve (not hang) even though no NOTIFY ever fired.
		await pending;
	});
});

describe("createWakeBus degrades safely", () => {
	test("a bad connection string rejects instead of silently no-oping — callers must catch and fall back to polling", async () => {
		await expect(
			createWakeBus(CHANNEL, {
				connectionString: "postgres://bad-host-does-not-resolve:5432/nope",
			}),
		).rejects.toBeTruthy();
	}, 10_000);
});
