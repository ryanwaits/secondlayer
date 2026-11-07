import { describe, expect, test } from "bun:test";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import {
	gateChainReorgOnLeader,
	isEvaluatorLeader,
	startTriggerEvaluatorLeader,
} from "./webhook-leader.ts";

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

describe("startTriggerEvaluatorLeader", () => {
	test("only the lock holder runs the evaluator loop", async () => {
		const { backend } = lockRegistry();
		let aStarted = 0;
		let bStarted = 0;

		const stopA = startTriggerEvaluatorLeader({
			createBackend: backend,
			pollMs: 10_000,
			startWork: () => {
				aStarted++;
				return () => {};
			},
		});
		const stopB = startTriggerEvaluatorLeader({
			createBackend: backend,
			pollMs: 10_000,
			startWork: () => {
				bStarted++;
				return () => {};
			},
		});

		await tick();
		expect(aStarted).toBe(1);
		expect(bStarted).toBe(0);
		expect(isEvaluatorLeader()).toBe(true);

		await stopA();
		await stopB();
	});

	test("isEvaluatorLeader is false once the leader relinquishes", async () => {
		const { backend } = lockRegistry();
		const stop = startTriggerEvaluatorLeader({
			createBackend: backend,
			pollMs: 10_000,
			startWork: () => () => {},
		});
		await tick();
		expect(isEvaluatorLeader()).toBe(true);

		await stop();
		expect(isEvaluatorLeader()).toBe(false);
	});
});

const REORG = {
	id: "r",
	detected_at: "2026-01-01T00:00:00Z",
	fork_point_height: 123,
	orphaned_range: { from: "123:0", to: "123:0" },
	new_canonical_tip: "123:0",
};

describe("gateChainReorgOnLeader", () => {
	test("skips the chain-reorg handler when not leader", async () => {
		let calls = 0;
		const gated = gateChainReorgOnLeader(
			async () => {
				calls++;
			},
			() => false,
		);
		await gated(123, REORG);
		expect(calls).toBe(0);
	});

	test("runs the chain-reorg handler when leader", async () => {
		const seen: number[] = [];
		const gated = gateChainReorgOnLeader(
			async (h) => {
				seen.push(h);
			},
			() => true,
		);
		await gated(123, REORG);
		expect(seen).toEqual([123]);
	});
});
