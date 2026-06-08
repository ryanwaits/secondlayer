import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	countRevertedByPayer,
	getX402PaymentByTxid,
	insertX402Payment,
	updateX402PaymentState,
} from "../ledger.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("x402_payments ledger", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM x402_payments`.execute(db);
	});

	test("insert → read → state transition", async () => {
		if (!db) throw new Error("missing db");
		await insertX402Payment(
			{
				nonce: "n-1",
				txid: "0xtx1",
				asset: "STX",
				amount: "1000",
				payer: "SP1PAYER",
				surface: "streams",
				state: "pending",
			},
			db,
		);

		const inserted = await getX402PaymentByTxid("0xtx1", db);
		expect(inserted).toMatchObject({ nonce: "n-1", state: "pending" });

		await updateX402PaymentState("0xtx1", "confirmed", db);
		expect((await getX402PaymentByTxid("0xtx1", db))?.state).toBe("confirmed");
	});

	test("counts reverted payments per payer (feeds v2 velocity limiter)", async () => {
		if (!db) throw new Error("missing db");
		await insertX402Payment(
			{
				nonce: "n-2",
				txid: "0xtx2",
				asset: "STX",
				amount: "1",
				payer: "SPX",
				surface: "index",
				state: "reverted",
			},
			db,
		);
		await insertX402Payment(
			{
				nonce: "n-3",
				txid: "0xtx3",
				asset: "STX",
				amount: "1",
				payer: "SPX",
				surface: "index",
				state: "confirmed",
			},
			db,
		);
		expect(await countRevertedByPayer("SPX", db)).toBe(1);
	});

	test("unique txid blocks double-redemption of one settlement", async () => {
		if (!db) throw new Error("missing db");
		const rec = {
			nonce: "n-4",
			txid: "0xdup",
			asset: "STX",
			amount: "1",
			payer: "SPD",
			surface: "streams",
			state: "confirmed" as const,
		};
		await insertX402Payment(rec, db);
		await expect(
			insertX402Payment({ ...rec, nonce: "n-5" }, db),
		).rejects.toThrow();
	});
});
