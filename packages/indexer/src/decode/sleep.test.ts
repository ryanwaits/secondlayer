import { describe, expect, test } from "bun:test";
import { sleep } from "./sleep.ts";

describe("sleep", () => {
	test("detaches its abort listener once the timer fires", async () => {
		const controller = new AbortController();
		let added = 0;
		let removed = 0;
		const add = controller.signal.addEventListener.bind(controller.signal);
		const remove = controller.signal.removeEventListener.bind(
			controller.signal,
		);
		controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
			added++;
			return add(...args);
		}) as typeof add;
		controller.signal.removeEventListener = ((
			...args: Parameters<typeof remove>
		) => {
			removed++;
			return remove(...args);
		}) as typeof remove;

		await sleep(1, controller.signal);
		await sleep(1, controller.signal);

		expect(added).toBe(2);
		expect(removed).toBe(2);
	});

	test("resolves early when aborted mid-sleep", async () => {
		const controller = new AbortController();
		const started = performance.now();
		const pending = sleep(10_000, controller.signal);
		controller.abort();
		await pending;
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	test("returns immediately on an already-aborted signal", async () => {
		const controller = new AbortController();
		controller.abort();
		const started = performance.now();
		await sleep(10_000, controller.signal);
		expect(performance.now() - started).toBeLessThan(50);
	});
});
