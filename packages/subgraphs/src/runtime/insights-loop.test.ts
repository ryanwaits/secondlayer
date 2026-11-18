import { describe, expect, test } from "bun:test";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import { startInsightsLoop } from "./insights-loop.ts";

/** One shared lock across "instances", simulating a single advisory lock. */
function lockRegistry() {
	const held = new Set<number>();
	function backend(): LeaderBackend {
		let mine: number | null = null;
		return {
			async tryAcquire(key) {
				if (held.has(key)) return false;
				held.add(key);
				mine = key;
				return true;
			},
			async ping() {},
			async close() {
				if (mine !== null) held.delete(mine);
				mine = null;
			},
		};
	}
	return { backend };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!cond() && Date.now() < deadline) {
		await sleep(10);
	}
}

describe("startInsightsLoop", () => {
	test("only the leader evaluates", async () => {
		const { backend } = lockRegistry();
		let a = 0;
		let b = 0;
		const stopA = startInsightsLoop({
			createBackend: backend,
			intervalMs: 10_000,
			evaluate: async () => {
				a++;
			},
		});
		const stopB = startInsightsLoop({
			createBackend: backend,
			intervalMs: 10_000,
			evaluate: async () => {
				b++;
			},
		});
		await waitFor(() => a === 1);
		expect(a).toBe(1);
		expect(b).toBe(0);
		await stopA();
		await stopB();
	});

	test("evaluates again on every interval", async () => {
		const { backend } = lockRegistry();
		let runs = 0;
		const stop = startInsightsLoop({
			createBackend: backend,
			intervalMs: 20,
			evaluate: async () => {
				runs++;
			},
		});
		await waitFor(() => runs >= 3);
		await stop();
		expect(runs).toBeGreaterThanOrEqual(3);
	});

	test("a failing pass is swallowed and the next one still runs", async () => {
		const { backend } = lockRegistry();
		let runs = 0;
		const stop = startInsightsLoop({
			createBackend: backend,
			intervalMs: 20,
			evaluate: async () => {
				runs++;
				throw new Error("db down");
			},
		});
		await waitFor(() => runs >= 2);
		await stop();
		expect(runs).toBeGreaterThanOrEqual(2);
	});

	test("never overlaps a slow pass", async () => {
		const { backend } = lockRegistry();
		let active = 0;
		let maxActive = 0;
		let completed = 0;
		const stop = startInsightsLoop({
			createBackend: backend,
			intervalMs: 10,
			evaluate: async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await sleep(50);
				active--;
				completed++;
			},
		});
		await waitFor(() => completed >= 2);
		await stop();
		expect(maxActive).toBe(1);
	});

	test("stop ends the interval and releases the lock", async () => {
		const { backend } = lockRegistry();
		let runs = 0;
		const stop = startInsightsLoop({
			createBackend: backend,
			intervalMs: 20,
			evaluate: async () => {
				runs++;
			},
		});
		await waitFor(() => runs >= 1);
		await stop();
		const after = runs;
		await sleep(80);
		expect(runs).toBe(after);

		// The lock is free again: a new instance becomes leader.
		let second = 0;
		const stop2 = startInsightsLoop({
			createBackend: backend,
			intervalMs: 10_000,
			evaluate: async () => {
				second++;
			},
		});
		await waitFor(() => second === 1);
		expect(second).toBe(1);
		await stop2();
	});
});
