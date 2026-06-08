import { describe, expect, test } from "bun:test";
import { isPaymentStillValid, sweepX402Reconcile } from "./x402-reconcile.ts";

describe("isPaymentStillValid", () => {
	test("canonical success → valid", () => {
		expect(isPaymentStillValid({ tx_status: "success", canonical: true })).toBe(
			true,
		);
		expect(isPaymentStillValid({ tx_status: "success" })).toBe(true);
	});
	test("missing / failed / reorged → invalid", () => {
		expect(isPaymentStillValid(null)).toBe(false);
		expect(isPaymentStillValid({ tx_status: "abort_by_response" })).toBe(false);
		expect(
			isPaymentStillValid({ tx_status: "success", canonical: false }),
		).toBe(false);
	});
});

describe("sweepX402Reconcile", () => {
	test("reverts only the confirmed rows whose tx is no longer canonical", async () => {
		const reverted: string[] = [];
		const result = await sweepX402Reconcile({
			listConfirmedTxids: async () => ["0xok", "0xgone", "0xreorged"],
			getTx: async (txid) =>
				txid === "0xok"
					? { tx_status: "success", canonical: true }
					: txid === "0xgone"
						? null
						: { tx_status: "success", canonical: false },
			markReverted: async (txid) => {
				reverted.push(txid);
			},
		});
		expect(result).toEqual({ checked: 3, reverted: 2 });
		expect(reverted.sort()).toEqual(["0xgone", "0xreorged"]);
	});

	test("empty ledger → no-op (no Hiro calls)", async () => {
		let getTxCalls = 0;
		const result = await sweepX402Reconcile({
			listConfirmedTxids: async () => [],
			getTx: async () => {
				getTxCalls++;
				return null;
			},
			markReverted: async () => {},
		});
		expect(result).toEqual({ checked: 0, reverted: 0 });
		expect(getTxCalls).toBe(0);
	});
});
