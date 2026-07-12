import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import {
	serializeTransactionHex,
	signTransactionWithAccount,
} from "@secondlayer/stacks/transactions";
import { buildExactTransfer } from "@secondlayer/stacks/x402";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import { getBalance, usdToMicros } from "../src/x402/balance.ts";
import type { X402Facilitator } from "../src/x402/facilitator.ts";
import { insertX402Payment } from "../src/x402/ledger.ts";
import { x402PaymentRequired } from "../src/x402/middleware.ts";
import { InProcNonceStore } from "../src/x402/nonce-store.ts";
import type { OptimisticGate } from "../src/x402/optimistic-gate.ts";

/**
 * f064 regression lock: a confirmed-tier deposit's ledger row and its balance
 * credit must land in one transaction. Before the fix they were two separate
 * statements (ledger insert in the middleware, credit in the route) — a crash
 * in between settled the customer's on-chain funds, recorded `confirmed`, and
 * never credited the tab, with no way to recover it after the fact.
 */

const SKIP = !process.env.DATABASE_URL;
const PAY_TO = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

function randomPrivateKey(): string {
	const hex = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
	return `${hex.slice(0, 64)}01`;
}

function b64decode<T>(v: string): T {
	return JSON.parse(Buffer.from(v, "base64").toString("utf8")) as T;
}
function b64encode(v: unknown): string {
	return Buffer.from(JSON.stringify(v), "utf8").toString("base64");
}

/** Deposit finality is always "confirmed" tier — no `optimistic` branch. */
function fakeFacilitator(state: "confirmed" | "pending"): X402Facilitator {
	return {
		network: X402_NETWORK.mainnet,
		payTo: PAY_TO,
		settle: async (args) => ({
			success: state === "confirmed",
			state,
			txid: `0x${crypto.randomUUID().replace(/-/g, "")}`,
			payer: args.payer,
			network: X402_NETWORK.mainnet,
		}),
	};
}

const denyOptimism: OptimisticGate = {
	canServeOptimistically: async () => false,
	recordStrike: async () => {},
	clear: async () => {},
};

async function usdcxPayment(
	payer: ReturnType<typeof privateKeyToAccount>,
	amount: string,
	nonce: string,
): Promise<string> {
	const usdcx = X402_TOKENS.USDCx;
	if (!usdcx.contractId || !usdcx.assetName) throw new Error("USDCx config");
	const tx = buildExactTransfer({
		asset: {
			kind: "sip010",
			contractId: usdcx.contractId,
			assetName: usdcx.assetName,
		},
		amount: BigInt(amount),
		payTo: PAY_TO,
		payer: payer.address,
		payerPublicKey: payer.publicKey,
		accountNonce: 0n,
		nonce,
	});
	const signed = await signTransactionWithAccount(tx, payer);
	return b64encode({
		x402Version: 2,
		scheme: "exact",
		network: X402_NETWORK.mainnet,
		asset: usdcx.asset,
		payload: { transaction: serializeTransactionHex(signed) },
		extra: { nonce },
	});
}

function buildDepositApp(opts: {
	facilitator: X402Facilitator;
	insertPayment?: typeof insertX402Payment;
}) {
	const app = new Hono();
	app.onError(errorHandler);
	app.use(
		"*",
		x402PaymentRequired({
			surface: "deposit",
			ledgerKind: "deposit",
			payTo: PAY_TO,
			facilitator: opts.facilitator,
			nonceStore: new InProcNonceStore(),
			optimisticGate: denyOptimism,
			isAccountBacked: () => false,
			insertPayment: opts.insertPayment,
		}),
	);
	app.post("/deposit", (c) => c.json({ ok: true }));
	return app;
}

async function challengeOffer(app: Hono) {
	const res = await app.request("/deposit", { method: "POST" });
	const challenge = b64decode<{
		accepts: { asset: string; amount: string; extra: { nonce: string } }[];
	}>(res.headers.get("PAYMENT-REQUIRED") as string);
	const offer = challenge.accepts.find(
		(a) => a.asset === X402_TOKENS.USDCx.asset,
	);
	if (!offer) throw new Error("no USDCx offer");
	return offer;
}

describe.skipIf(SKIP)("confirmed-deposit atomic credit", () => {
	const cleanupTxids: string[] = [];
	const cleanupPayers: string[] = [];

	afterAll(async () => {
		const db = getDb();
		if (cleanupTxids.length) {
			await db
				.deleteFrom("x402_payments")
				.where("txid", "in", cleanupTxids)
				.execute();
		}
		if (cleanupPayers.length) {
			await db
				.deleteFrom("x402_balances")
				.where("principal", "in", cleanupPayers)
				.execute();
		}
	});

	test("confirmed deposit credits exactly once", async () => {
		const payer = privateKeyToAccount(randomPrivateKey());
		cleanupPayers.push(payer.address);
		const app = buildDepositApp({ facilitator: fakeFacilitator("confirmed") });
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(payer, offer.amount, offer.extra.nonce);

		const res = await app.request("/deposit", {
			method: "POST",
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(res.status).toBe(200);

		const db = getDb();
		const row = await db
			.selectFrom("x402_payments")
			.selectAll()
			.where("payer", "=", payer.address)
			.executeTakeFirst();
		expect(row?.state).toBe("confirmed");
		if (row) cleanupTxids.push(row.txid);

		// Exactly the deposit-floor amount — not 2x (the bug credited once here
		// AND again in the route handler).
		const balance = await getBalance(db, payer.address);
		expect(balance).toBe(usdToMicros(0.25));
	});

	test("credit and ledger row commit together (atomic rollback)", async () => {
		const payer = privateKeyToAccount(randomPrivateKey());
		cleanupPayers.push(payer.address);
		// Simulates a crash between the ledger write and the credit: the ledger
		// row is actually inserted against the transaction, then the write path
		// throws. If the two writes aren't atomic, the insert survives; if they
		// are (the fix), the whole transaction rolls back.
		const crashAfterLedgerWrite: typeof insertX402Payment = async (
			record,
			db,
		) => {
			await insertX402Payment(record, db);
			throw new Error("simulated crash after ledger write, before credit");
		};
		const app = buildDepositApp({
			facilitator: fakeFacilitator("confirmed"),
			insertPayment: crashAfterLedgerWrite,
		});
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(payer, offer.amount, offer.extra.nonce);

		const res = await app.request("/deposit", {
			method: "POST",
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(res.status).toBe(500);

		const db = getDb();
		const row = await db
			.selectFrom("x402_payments")
			.selectAll()
			.where("payer", "=", payer.address)
			.executeTakeFirst();
		expect(row).toBeUndefined();

		const balance = await getBalance(db, payer.address);
		expect(balance).toBe(0n);
	});

	test("pending deposit is not credited at serve time", async () => {
		const payer = privateKeyToAccount(randomPrivateKey());
		cleanupPayers.push(payer.address);
		const app = buildDepositApp({ facilitator: fakeFacilitator("pending") });
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(payer, offer.amount, offer.extra.nonce);

		const res = await app.request("/deposit", {
			method: "POST",
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(res.status).toBe(402);

		const db = getDb();
		const row = await db
			.selectFrom("x402_payments")
			.selectAll()
			.where("payer", "=", payer.address)
			.executeTakeFirst();
		expect(row?.state).toBe("pending");
		if (row) cleanupTxids.push(row.txid);

		// Not credited yet — the reconciler credits it once canonical.
		const balance = await getBalance(db, payer.address);
		expect(balance).toBe(0n);
	});
});
