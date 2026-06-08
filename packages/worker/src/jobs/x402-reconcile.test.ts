import { describe, expect, test } from "bun:test";
import {
	type ReconcilePayment,
	reconcilePayment,
	sweepX402Reconcile,
} from "./x402-reconcile.ts";

function payment(over: Partial<ReconcilePayment> = {}): ReconcilePayment {
	return {
		txid: "0xtx",
		payer: "SP1",
		state: "pending",
		createdAtMs: 1_000,
		...over,
	};
}

describe("reconcilePayment", () => {
	test("pending → confirmed once canonical (persists confirmed)", async () => {
		const updates: [string, string][] = [];
		const state = await reconcilePayment(payment({ state: "pending" }), {
			isCanonical: async () => true,
			updateState: async (txid, s) => {
				updates.push([txid, s]);
			},
			recordStrike: async () => {},
			now: () => 2_000,
		});
		expect(state).toBe("confirmed");
		expect(updates).toEqual([["0xtx", "confirmed"]]);
	});

	test("pending + not canonical + within grace → stays pending (no write)", async () => {
		let wrote = false;
		const state = await reconcilePayment(payment({ createdAtMs: 1_000 }), {
			isCanonical: async () => false,
			updateState: async () => {
				wrote = true;
			},
			recordStrike: async () => {
				wrote = true;
			},
			now: () => 2_000, // 1s old, grace 60s
			graceMs: 60_000,
		});
		expect(state).toBe("pending");
		expect(wrote).toBe(false);
	});

	test("pending past grace + not canonical → reverted + strike", async () => {
		const strikes: string[] = [];
		const updates: [string, string][] = [];
		const state = await reconcilePayment(payment({ createdAtMs: 0 }), {
			isCanonical: async () => false,
			updateState: async (txid, s) => {
				updates.push([txid, s]);
			},
			recordStrike: async (p) => {
				strikes.push(p);
			},
			now: () => 10 * 60_000, // 10 min old
			graceMs: 5 * 60_000,
		});
		expect(state).toBe("reverted");
		expect(updates).toEqual([["0xtx", "reverted"]]);
		expect(strikes).toEqual(["SP1"]);
	});

	test("confirmed row that reorged out → reverted + strike", async () => {
		const strikes: string[] = [];
		const state = await reconcilePayment(payment({ state: "confirmed" }), {
			isCanonical: async () => false,
			updateState: async () => {},
			recordStrike: async (p) => {
				strikes.push(p);
			},
			now: () => 2_000,
		});
		expect(state).toBe("reverted");
		expect(strikes).toEqual(["SP1"]);
	});
});

describe("sweepX402Reconcile", () => {
	test("counts newly-confirmed and reverted across the batch", async () => {
		const result = await sweepX402Reconcile({
			list: async () => [
				payment({ txid: "0xok", state: "pending", createdAtMs: 0 }),
				payment({ txid: "0xdrop", state: "pending", createdAtMs: 0 }),
			],
			isCanonical: async (txid) => txid === "0xok",
			updateState: async () => {},
			recordStrike: async () => {},
			now: () => 10 * 60_000,
			graceMs: 5 * 60_000,
		});
		expect(result).toEqual({ checked: 2, confirmed: 1, reverted: 1 });
	});
});
