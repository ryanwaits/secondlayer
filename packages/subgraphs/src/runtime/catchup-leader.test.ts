import { describe, expect, test } from "bun:test";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import { isCatchUpLeader, startCatchUpLeader } from "./catchup-leader.ts";

/** One shared lock across "instances", simulating a single Postgres advisory lock. */
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

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("startCatchUpLeader", () => {
	test("only the lock holder catches up; the other stays a no-op", async () => {
		const { backend } = lockRegistry();
		let aRuns = 0;
		let bRuns = 0;

		const stopA = startCatchUpLeader({
			createBackend: backend,
			pollMs: 10_000,
			onAcquire: () => {
				aRuns++;
			},
		});
		const stopB = startCatchUpLeader({
			createBackend: backend,
			pollMs: 10_000,
			onAcquire: () => {
				bRuns++;
			},
		});

		await tick();
		// Exactly one acquired and ran its immediate catch-up.
		expect(aRuns).toBe(1);
		expect(bRuns).toBe(0);
		expect(isCatchUpLeader()).toBe(true);

		await stopA();
		await stopB();
	});

	test("isCatchUpLeader is false once the leader relinquishes", async () => {
		const { backend } = lockRegistry();
		const stop = startCatchUpLeader({
			createBackend: backend,
			pollMs: 10_000,
		});
		await tick();
		expect(isCatchUpLeader()).toBe(true);

		await stop();
		expect(isCatchUpLeader()).toBe(false);
	});
});
