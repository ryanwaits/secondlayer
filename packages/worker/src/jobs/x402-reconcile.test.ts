import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	type ReconcilePayment,
	depositCreditMicros,
	reconcilePayment,
	shouldDebitOnRevert,
	sweepX402Reconcile,
} from "./x402-reconcile.ts";

const SKIP_DB = !process.env.DATABASE_URL;

function payment(over: Partial<ReconcilePayment> = {}): ReconcilePayment {
	return {
		txid: "0xtx",
		payer: "SP1",
		state: "pending",
		createdAtMs: 1_000,
		kind: "payment",
		creditUsdMicros: null,
		creditedAtMs: null,
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
				// Already carries a credit marker (already credited) — must not
				// re-confirm OR re-heal.
				creditedAtMs: 500,
			}),
			{
				isCanonical: async () => true,
				confirmPayment: async () => {
					called = true;
				},
				healCredit: async () => {
					called = true;
				},
				now: () => 2_000,
			},
		);
		expect(state).toBe("confirmed");
		expect(called).toBe(false);
	});

	// A confirmed deposit with no credit marker (credited_at IS NULL) is the
	// genuinely-uncredited case the heal path exists for — only reachable by
	// rows created after the credited_at migration (pre-existing confirmed
	// deposits are backfilled to a non-null sentinel and can never land here).
	test("a confirmed deposit with no credit marker is healed exactly once", async () => {
		let healCalls = 0;
		const state = await reconcilePayment(
			payment({
				state: "confirmed",
				kind: "deposit",
				creditUsdMicros: "250000",
				creditedAtMs: null,
			}),
			{
				isCanonical: async () => true,
				confirmPayment: async () => {
					throw new Error("must not re-confirm an already-confirmed row");
				},
				healCredit: async () => {
					healCalls++;
				},
				now: () => 2_000,
			},
		);
		expect(state).toBe("confirmed");
		expect(healCalls).toBe(1);
	});

	// Regression lock against double-crediting historical/backfilled rows: a
	// confirmed deposit that already carries a credit marker must never be
	// healed again, no matter how many sweeps re-check it.
	test("a confirmed deposit already carrying a credit marker is not re-credited", async () => {
		let healCalls = 0;
		const state = await reconcilePayment(
			payment({
				state: "confirmed",
				kind: "deposit",
				creditUsdMicros: "250000",
				creditedAtMs: 500,
			}),
			{
				isCanonical: async () => true,
				healCredit: async () => {
					healCalls++;
				},
				now: () => 2_000,
			},
		);
		expect(state).toBe("confirmed");
		expect(healCalls).toBe(0);
	});

	test("a confirmed non-deposit row is never healed", async () => {
		let healCalls = 0;
		const state = await reconcilePayment(
			payment({
				state: "confirmed",
				kind: "payment",
				creditUsdMicros: null,
				creditedAtMs: null,
			}),
			{
				isCanonical: async () => true,
				healCredit: async () => {
					healCalls++;
				},
				now: () => 2_000,
			},
		);
		expect(state).toBe("confirmed");
		expect(healCalls).toBe(0);
	});

	test("a canonical pending deposit still confirms and credits via confirmPayment, not healCredit", async () => {
		let confirmCalls = 0;
		let healCalls = 0;
		const state = await reconcilePayment(
			payment({
				state: "pending",
				kind: "deposit",
				creditUsdMicros: "250000",
				creditedAtMs: null,
			}),
			{
				isCanonical: async () => true,
				confirmPayment: async () => {
					confirmCalls++;
				},
				healCredit: async () => {
					healCalls++;
				},
				now: () => 2_000,
			},
		);
		expect(state).toBe("confirmed");
		expect(confirmCalls).toBe(1);
		expect(healCalls).toBe(0);
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

// DB-level lock on the heal path itself (defaultHealCredit, not injected):
// a confirmed deposit that was never credited gets credited exactly the
// deposit amount, and a second heal attempt against the same stale read is a
// guarded no-op — the DB-side `credited_at IS NULL` guard, not just the
// in-process check, is what makes concurrent sweeps safe.
describe.skipIf(SKIP_DB)("heal path (real DB)", () => {
	const payer = `heal-test-${crypto.randomUUID()}`;
	const txid = `0xheal${crypto.randomUUID().replace(/-/g, "")}`;
	const nonce = crypto.randomUUID();

	afterAll(async () => {
		const db = getDb();
		await db.deleteFrom("x402_payments").where("txid", "=", txid).execute();
		await db
			.deleteFrom("x402_balances")
			.where("principal", "=", payer)
			.execute();
	});

	test("a confirmed-uncredited deposit is credited once, and a second heal attempt is a no-op", async () => {
		const db = getDb();
		await db
			.insertInto("x402_payments")
			.values({
				nonce,
				txid,
				asset: "USDCx",
				amount: "250000",
				payer,
				surface: "deposit",
				state: "confirmed",
				kind: "deposit",
				credit_usd_micros: "250000",
				credited_at: null,
			})
			.execute();

		const p: ReconcilePayment = {
			txid,
			payer,
			state: "confirmed",
			createdAtMs: Date.now(),
			kind: "deposit",
			creditUsdMicros: "250000",
			creditedAtMs: null,
		};

		// First heal: real defaultHealCredit (no deps injected beyond
		// isCanonical) credits the balance and stamps credited_at.
		await reconcilePayment(p, { isCanonical: async () => true });

		const balanceAfterFirst = await db
			.selectFrom("x402_balances")
			.select("balance_usd_micros")
			.where("principal", "=", payer)
			.executeTakeFirst();
		expect(String(balanceAfterFirst?.balance_usd_micros)).toBe("250000");

		const rowAfterFirst = await db
			.selectFrom("x402_payments")
			.select("credited_at")
			.where("txid", "=", txid)
			.executeTakeFirst();
		expect(rowAfterFirst?.credited_at).not.toBeNull();

		// Second heal against the SAME stale `p` (creditedAtMs still null, as a
		// concurrent sweep reading a pre-heal snapshot would see) — the DB-side
		// `credited_at IS NULL` guard must make this a no-op, not a double credit.
		await reconcilePayment(p, { isCanonical: async () => true });

		const balanceAfterSecond = await db
			.selectFrom("x402_balances")
			.select("balance_usd_micros")
			.where("principal", "=", payer)
			.executeTakeFirst();
		expect(String(balanceAfterSecond?.balance_usd_micros)).toBe("250000");
	});
});
