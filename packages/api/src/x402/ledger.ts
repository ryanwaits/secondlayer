import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

/**
 * x402 payment ledger reader/writer. Accountless payers skip the account-keyed
 * usage/billing path entirely, so this is their accounting record — keyed by the
 * challenge nonce + settled txid (control plane, written on settle).
 */

export type X402PaymentState = "pending" | "confirmed" | "reverted";

export type X402PaymentRecord = {
	nonce: string;
	txid: string;
	asset: string;
	amount: string;
	payer: string;
	surface: string;
	state: X402PaymentState;
	/** "payment" (per-call settle, default) or "deposit" (prepaid top-up). */
	kind?: "payment" | "deposit";
};

export async function insertX402Payment(
	record: X402PaymentRecord,
	db: Kysely<Database> = getDb(),
): Promise<void> {
	await db.insertInto("x402_payments").values(record).execute();
}

export async function updateX402PaymentState(
	txid: string,
	state: X402PaymentState,
	db: Kysely<Database> = getDb(),
): Promise<void> {
	await db
		.updateTable("x402_payments")
		.set({ state, updated_at: sql`now()` })
		.where("txid", "=", txid)
		.execute();
}

export async function getX402PaymentByTxid(
	txid: string,
	db: Kysely<Database> = getDb(),
): Promise<X402PaymentRecord | null> {
	const row = await db
		.selectFrom("x402_payments")
		.select(["nonce", "txid", "asset", "amount", "payer", "surface", "state"])
		.where("txid", "=", txid)
		.executeTakeFirst();
	return row ?? null;
}

/** Count a principal's reverted (pay-then-drop) payments — feeds the v2 velocity
 *  limiter; today it surfaces abuse in metrics. */
export async function countRevertedByPayer(
	payer: string,
	db: Kysely<Database> = getDb(),
): Promise<number> {
	const row = await db
		.selectFrom("x402_payments")
		.select((eb) => eb.fn.countAll<string>().as("count"))
		.where("payer", "=", payer)
		.where("state", "=", "reverted")
		.executeTakeFirst();
	return row ? Number(row.count) : 0;
}
