import { describe, expect, test } from "bun:test";
import {
	type ReconcilePayment,
	depositCreditMicros,
	reconcilePayment,
	shouldDebitOnRevert,
	sweepX402Reconcile,
} from "./x402-reconcile.ts";

function payment(over: Partial<ReconcilePayment> = {}): ReconcilePayment {
	return {
		txid: "0xtx",
		payer: "SP1",
		state: "pending",
		createdAtMs: 1_000,
		kind: "payment",
		creditUsdMicros: null,
		...over,
	};
}

describe("reconcilePayment", () => {
	test("pending → confirmed once canonical (via confirmPayment)", async () => {
		const confirmed: ReconcilePayment[] = [];
		const state = await reconcilePayment(payment({ state: "pending" }), {
			isCanonical: async () => true,
			confirmPayment: async (p) => {
				confirmed.push(p);
			},
			recordStrike: async () => {},
			now: () => 2_000,
		});
		expect(state).toBe("confirmed");
		expect(confirmed.map((p) => p.txid)).toEqual(["0xtx"]);
	});

	// R7 regression: a deposit that confirms asynchronously MUST be credited.
	// Before the fix the reconciler only flipped state and never credited, so a
	// slow-confirming on-chain deposit was charged but lost.
	test("deposit pending → canonical → confirm path carries the credit amount", async () => {
		const confirmed: ReconcilePayment[] = [];
		await reconcilePayment(
			payment({ state: "pending", kind: "deposit", creditUsdMicros: "250000" }),
			{
				isCanonical: async () => true,
				confirmPayment: async (p) => {
					confirmed.push(p);
				},
			},
		);
		expect(confirmed).toHaveLength(1);
		expect(
			depositCreditMicros(confirmed[0].kind, confirmed[0].creditUsdMicros),
		).toBe(250_000n);
	});

	test("a per-call payment never credits a balance on confirm", () => {
		expect(depositCreditMicros("payment", null)).toBeNull();
		expect(depositCreditMicros("payment", "1000")).toBeNull();
	});

	test("depositCreditMicros: deposit with amount credits; zero/empty does not", () => {
		expect(depositCreditMicros("deposit", "250000")).toBe(250_000n);
		expect(depositCreditMicros("deposit", "0")).toBeNull();
		expect(depositCreditMicros("deposit", null)).toBeNull();
	});

	test("already-confirmed canonical row is not re-confirmed (no re-credit)", async () => {
		let called = false;
		const state = await reconcilePayment(
			payment({
				state: "confirmed",
				kind: "deposit",
				creditUsdMicros: "250000",
			}),
			{
				isCanonical: async () => true,
				confirmPayment: async () => {
					called = true;
				},
				now: () => 2_000,
			},
		);
		expect(state).toBe("confirmed");
		expect(called).toBe(false);
	});

	test("pending + not canonical + within grace → stays pending (no write)", async () => {
		let wrote = false;
		const state = await reconcilePayment(payment({ createdAtMs: 1_000 }), {
			isCanonical: async () => false,
			revertPayment: async () => {
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
		const reverted: string[] = [];
		const state = await reconcilePayment(payment({ createdAtMs: 0 }), {
			isCanonical: async () => false,
			revertPayment: async (p) => {
				reverted.push(p.txid);
			},
			recordStrike: async (p) => {
				strikes.push(p);
			},
			now: () => 10 * 60_000, // 10 min old
			graceMs: 5 * 60_000,
		});
		expect(state).toBe("reverted");
		expect(reverted).toEqual(["0xtx"]);
		expect(strikes).toEqual(["SP1"]);
	});

	test("confirmed row that reorged out → reverted + strike", async () => {
		const strikes: string[] = [];
		const state = await reconcilePayment(payment({ state: "confirmed" }), {
			isCanonical: async () => false,
			revertPayment: async () => {},
			recordStrike: async (p) => {
				strikes.push(p);
			},
			now: () => 2_000,
		});
		expect(state).toBe("reverted");
		expect(strikes).toEqual(["SP1"]);
	});

	// F-047 regression: a confirmed deposit that reorgs out MUST claw back the
	// credit it received on confirmation, not just flip state.
	test("confirmed deposit reorged out → revertPayment called with the credited row", async () => {
		const reverted: ReconcilePayment[] = [];
		const state = await reconcilePayment(
			payment({
				state: "confirmed",
				kind: "deposit",
				creditUsdMicros: "250000",
			}),
			{
				isCanonical: async () => false,
				revertPayment: async (p) => {
					reverted.push(p);
				},
				recordStrike: async () => {},
				now: () => 2_000,
			},
		);
		expect(state).toBe("reverted");
		expect(reverted).toHaveLength(1);
		expect(reverted[0].kind).toBe("deposit");
		expect(
			depositCreditMicros(reverted[0].kind, reverted[0].creditUsdMicros),
		).toBe(250_000n);
	});

	test("a pending deposit still confirming after the payment grace is not reverted", async () => {
		let reverted = false;
		let struck = false;
		const tenMinutes = 10 * 60_000;
		const state = await reconcilePayment(
			payment({ state: "pending", kind: "deposit", createdAtMs: 0 }),
			{
				isCanonical: async () => false,
				revertPayment: async () => {
					reverted = true;
				},
				recordStrike: async () => {
					struck = true;
				},
				now: () => tenMinutes, // past the 5-minute payment grace, well within the deposit grace
			},
		);
		expect(state).toBe("pending");
		expect(reverted).toBe(false);
		expect(struck).toBe(false);
	});

	test("a pending deposit that ages out past the deposit grace is reverted without a strike", async () => {
		const reverted: string[] = [];
		let struck = false;
		const state = await reconcilePayment(
			payment({ state: "pending", kind: "deposit", createdAtMs: 0 }),
			{
				isCanonical: async () => false,
				revertPayment: async (p) => {
					reverted.push(p.txid);
				},
				recordStrike: async () => {
					struck = true;
				},
				now: () => 7 * 60 * 60_000, // 7h old, past the 6h deposit grace
			},
		);
		expect(state).toBe("reverted");
		expect(reverted).toEqual(["0xtx"]);
		expect(struck).toBe(false);
	});

	test("a confirmed deposit that loses canonicality still reverts and strikes", async () => {
		const reverted: string[] = [];
		const strikes: string[] = [];
		const state = await reconcilePayment(
			payment({
				state: "confirmed",
				kind: "deposit",
				creditUsdMicros: "250000",
				createdAtMs: 0,
			}),
			{
				isCanonical: async () => false,
				revertPayment: async (p) => {
					reverted.push(p.txid);
				},
				recordStrike: async (principal) => {
					strikes.push(principal);
				},
				now: () => 7 * 60 * 60_000, // well past any grace — irrelevant for a reorg
			},
		);
		expect(state).toBe("reverted");
		expect(reverted).toEqual(["0xtx"]);
		expect(strikes).toEqual(["SP1"]);
	});

	test("a pending payment still reverts at the 5-minute grace", async () => {
		const reverted: string[] = [];
		const strikes: string[] = [];
		const state = await reconcilePayment(
			payment({ state: "pending", kind: "payment", createdAtMs: 0 }),
			{
				isCanonical: async () => false,
				revertPayment: async (p) => {
					reverted.push(p.txid);
				},
				recordStrike: async (principal) => {
					strikes.push(principal);
				},
				now: () => 6 * 60_000, // 6 min old, past the 5-minute payment grace
			},
		);
		expect(state).toBe("reverted");
		expect(reverted).toEqual(["0xtx"]);
		expect(strikes).toEqual(["SP1"]);
	});

	test("a slow deposit that becomes canonical later is confirmed and credited", async () => {
		const confirmed: ReconcilePayment[] = [];
		const p = payment({
			state: "pending",
			kind: "deposit",
			creditUsdMicros: "250000",
			createdAtMs: 0,
		});

		// First sweep: still not canonical, but within the deposit grace — stays pending.
		const first = await reconcilePayment(p, {
			isCanonical: async () => false,
			revertPayment: async () => {
				throw new Error("must not revert while still within grace");
			},
			now: () => 10 * 60_000, // 10 min old
		});
		expect(first).toBe("pending");

		// Later sweep: now canonical — confirms and credits.
		const second = await reconcilePayment(p, {
			isCanonical: async () => true,
			confirmPayment: async (row) => {
				confirmed.push(row);
			},
			now: () => 20 * 60_000,
		});
		expect(second).toBe("confirmed");
		expect(confirmed).toHaveLength(1);
		expect(
			depositCreditMicros(confirmed[0].kind, confirmed[0].creditUsdMicros),
		).toBe(250_000n);
	});
});

describe("shouldDebitOnRevert", () => {
	test("confirmed deposit with a positive credit → debit", () => {
		expect(
			shouldDebitOnRevert(
				payment({
					state: "confirmed",
					kind: "deposit",
					creditUsdMicros: "250000",
				}),
			),
		).toBe(true);
	});

	test("pending deposit (never credited) → no debit", () => {
		expect(
			shouldDebitOnRevert(
				payment({
					state: "pending",
					kind: "deposit",
					creditUsdMicros: "250000",
				}),
			),
		).toBe(false);
	});

	test("confirmed per-call payment (no credit ever) → no debit", () => {
		expect(
			shouldDebitOnRevert(
				payment({ state: "confirmed", kind: "payment", creditUsdMicros: null }),
			),
		).toBe(false);
	});

	test("confirmed deposit with zero credit → no debit", () => {
		expect(
			shouldDebitOnRevert(
				payment({ state: "confirmed", kind: "deposit", creditUsdMicros: "0" }),
			),
		).toBe(false);
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
			confirmPayment: async () => {},
			revertPayment: async () => {},
			recordStrike: async () => {},
			now: () => 10 * 60_000,
			graceMs: 5 * 60_000,
		});
		expect(result).toEqual({ checked: 2, confirmed: 1, reverted: 1 });
	});

	// f054: canonicality for the whole sweep must resolve in a single batched
	// call, not once per payment — the resolver is a spy here precisely to
	// prove that (no DB harness needed since deps are injected).
	test("resolves canonicality once for the whole batch, not once per payment", async () => {
		const payments = [
			payment({ txid: "0xa", state: "pending", createdAtMs: 0 }),
			payment({ txid: "0xb", state: "pending", createdAtMs: 0 }),
			payment({ txid: "0xc", state: "pending", createdAtMs: 0 }),
		];
		let resolveCalls = 0;
		const result = await sweepX402Reconcile({
			list: async () => payments,
			resolveCanonicalSet: async (txids) => {
				resolveCalls++;
				expect(txids).toEqual(["0xa", "0xb", "0xc"]);
				return new Set(["0xa", "0xc"]);
			},
			confirmPayment: async () => {},
			revertPayment: async () => {},
			recordStrike: async () => {},
			now: () => 10 * 60_000,
			graceMs: 5 * 60_000,
		});
		expect(resolveCalls).toBe(1);
		expect(result).toEqual({ checked: 3, confirmed: 2, reverted: 1 });
	});

	test("an injected isCanonical still wins over the batched resolver", async () => {
		let resolveCalls = 0;
		const result = await sweepX402Reconcile({
			list: async () => [
				payment({ txid: "0xok", state: "pending", createdAtMs: 0 }),
			],
			resolveCanonicalSet: async () => {
				resolveCalls++;
				return new Set();
			},
			isCanonical: async (txid) => txid === "0xok",
			confirmPayment: async () => {},
			revertPayment: async () => {},
			recordStrike: async () => {},
			now: () => 10 * 60_000,
			graceMs: 5 * 60_000,
		});
		expect(resolveCalls).toBe(0);
		expect(result).toEqual({ checked: 1, confirmed: 1, reverted: 0 });
	});
});
