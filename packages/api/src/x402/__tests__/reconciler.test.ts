import { describe, expect, test } from "bun:test";
import type { X402PaymentRecord } from "../ledger.ts";
import { reconcileX402Payment } from "../reconciler.ts";

const confirmed: X402PaymentRecord = {
	nonce: "n1",
	txid: "0xabc",
	asset: "STX",
	amount: "1000",
	payer: "SP1",
	surface: "streams",
	state: "confirmed",
};

describe("reconcileX402Payment", () => {
	test("still a canonical success → stays confirmed (no write)", async () => {
		let wrote = false;
		const state = await reconcileX402Payment(confirmed, {
			getTx: async () => ({ tx_status: "success", canonical: true }),
			updateState: async () => {
				wrote = true;
			},
		});
		expect(state).toBe("confirmed");
		expect(wrote).toBe(false);
	});

	test("dropped tx (gone) → reverted (persisted)", async () => {
		const writes: [string, string][] = [];
		const state = await reconcileX402Payment(confirmed, {
			getTx: async () => null,
			updateState: async (txid, s) => {
				writes.push([txid, s]);
			},
		});
		expect(state).toBe("reverted");
		expect(writes).toEqual([["0xabc", "reverted"]]);
	});

	test("reorged-out (non-canonical) → reverted", async () => {
		const state = await reconcileX402Payment(confirmed, {
			getTx: async () => ({ tx_status: "success", canonical: false }),
			updateState: async () => {},
		});
		expect(state).toBe("reverted");
	});

	test("a non-confirmed row is left untouched", async () => {
		let wrote = false;
		const state = await reconcileX402Payment(
			{ ...confirmed, state: "pending" },
			{
				getTx: async () => null,
				updateState: async () => {
					wrote = true;
				},
			},
		);
		expect(state).toBe("pending");
		expect(wrote).toBe(false);
	});
});
