import { describe, expect, test } from "bun:test";
import { type LeaderBackend, withLeaderLock } from "./leader.ts";

/** A single shared lock across "instances", simulating one Postgres lock. */
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
	return { held, backend };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withLeaderLock", () => {
	test("only one instance acquires the lock and runs work", async () => {
		const { backend } = lockRegistry();
		let aStarted = 0;
		let bStarted = 0;

		const stopA = withLeaderLock(
			1,
			() => {
				aStarted++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);
		const stopB = withLeaderLock(
			1,
			() => {
				bStarted++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);

		await tick();
		expect(aStarted).toBe(1);
		expect(bStarted).toBe(0);

		await stopA();
		await stopB();
	});

	test("releasing the leader frees the lock for the standby", async () => {
		const { held, backend } = lockRegistry();
		let started = 0;

		const stopA = withLeaderLock(
			1,
			() => {
				started++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);
		await tick();
		expect(started).toBe(1);
		expect(held.has(1)).toBe(true);

		// Leader releases → lock is free.
		await stopA();
		expect(held.has(1)).toBe(false);

		// A fresh standby can now acquire immediately.
		const stopB = withLeaderLock(
			1,
			() => {
				started++;
				return () => {};
			},
			{ createBackend: backend, pollMs: 10_000 },
		);
		await tick();
		expect(started).toBe(2);
		expect(held.has(1)).toBe(true);
		await stopB();
	});
});
