import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	MEMPOOL_RETENTION_HOURS,
	buildMempoolRow,
	ingestMempoolTxs,
	isGenuineDrop,
	mempoolDepth,
	removeMempoolTxs,
	sweepStaleMempool,
	txidFromRawTx,
} from "./mempool.ts";

const HAS_DB = !!process.env.DATABASE_URL;

// Real mainnet transactions (txid is the on-chain id the node computes, used as
// the oracle for our raw_tx -> txid derivation).
const TOKEN_TRANSFER = {
	txid: "0x44fcbeb8a54540234eb2885b64b35b30112b6aa75cff10bb78e7ebf52adf49b7",
	raw_tx:
		"0x00000000010400f2bba6df751755ab9ac1df8b387d981cfe265cdf000000000023b83c00000000000000b4000105c7d1e497ff1e980f6504947cd9f079f793041009c69179357883ec13c2b7661e541151591a4ededf6b0801d1a01ee32333420459d6029788001ceded4c5164030200000000000516fbd9a1702f4ecc44fc01f1894c72fcbb23a53ce8000000000000000100000000000000000000000000000000000000000000000000000000000000000000",
	sender: "SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2",
};

describe("mempool ingest helpers", () => {
	test("derives the on-chain txid from raw_tx", () => {
		expect(txidFromRawTx(TOKEN_TRANSFER.raw_tx)).toBe(TOKEN_TRANSFER.txid);
	});

	test("builds a mempool row with the derived txid and decoded fields", () => {
		const row = buildMempoolRow(TOKEN_TRANSFER.raw_tx);
		expect(row).not.toBeNull();
		expect(row?.tx_id).toBe(TOKEN_TRANSFER.txid);
		expect(row?.type).toBe("token_transfer");
		expect(row?.sender).toBe(TOKEN_TRANSFER.sender);
		expect(row?.contract_id).toBeNull();
		expect(row?.function_name).toBeNull();
		expect(row?.raw_tx).toBe(TOKEN_TRANSFER.raw_tx);
	});

	test("returns null for an undecodable raw_tx", () => {
		expect(buildMempoolRow("0x00")).toBeNull();
		expect(buildMempoolRow("0xnothex")).toBeNull();
	});

	test("ignores StaleGarbageCollect drops, honors genuine ones", () => {
		expect(isGenuineDrop("StaleGarbageCollect")).toBe(false);
		expect(isGenuineDrop("ReplaceByFee")).toBe(true);
		expect(isGenuineDrop("ReplaceAcrossFork")).toBe(true);
		expect(isGenuineDrop("Problematic")).toBe(true);
	});

	test("retention default is 72h (env-tunable)", () => {
		if (process.env.MEMPOOL_RETENTION_HOURS === undefined) {
			expect(MEMPOOL_RETENTION_HOURS).toBe(72);
		}
		expect(MEMPOOL_RETENTION_HOURS).toBeGreaterThan(0);
	});
});

describe.skipIf(!HAS_DB)("mempool ingest DB", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM mempool_transactions`.execute(db);
	});

	async function count() {
		if (!db) throw new Error("missing db");
		const { rows } = await sql<{ n: string }>`
			SELECT count(*)::text AS n FROM mempool_transactions
		`.execute(db);
		return Number(rows[0]?.n ?? 0);
	}

	test("ingests a batch and is idempotent on tx_id", async () => {
		if (!db) throw new Error("missing db");
		const written = await ingestMempoolTxs(db, [TOKEN_TRANSFER.raw_tx]);
		expect(written).toBe(1);
		expect(await count()).toBe(1);

		// Re-ingesting the same raw_tx is a no-op (ON CONFLICT DO NOTHING).
		await ingestMempoolTxs(db, [TOKEN_TRANSFER.raw_tx]);
		expect(await count()).toBe(1);
	});

	test("skips undecodable txs in a batch", async () => {
		if (!db) throw new Error("missing db");
		const written = await ingestMempoolTxs(db, [TOKEN_TRANSFER.raw_tx, "0x00"]);
		expect(written).toBe(1);
		expect(await count()).toBe(1);
	});

	test("removeMempoolTxs deletes by tx_id and ignores unknown ids", async () => {
		if (!db) throw new Error("missing db");
		await ingestMempoolTxs(db, [TOKEN_TRANSFER.raw_tx]);
		await removeMempoolTxs(db, ["0xunknown"]);
		expect(await count()).toBe(1);
		await removeMempoolTxs(db, [TOKEN_TRANSFER.txid]);
		expect(await count()).toBe(0);
	});

	test("sweepStaleMempool removes rows older than the window, keeps fresh", async () => {
		if (!db) throw new Error("missing db");
		await ingestMempoolTxs(db, [TOKEN_TRANSFER.raw_tx]); // fresh (received_at = now)
		await db
			.insertInto("mempool_transactions")
			.values({
				tx_id: "0xstale",
				raw_tx: "0x00",
				type: "token_transfer",
				sender: "SP1",
				contract_id: null,
				function_name: null,
				function_args: null,
				received_at: new Date(Date.now() - 48 * 3_600_000),
			})
			.execute();
		expect(await count()).toBe(2);

		const deleted = await sweepStaleMempool(db, 24);
		expect(deleted).toBe(1);
		expect(await count()).toBe(1);
	});

	test("72h window keeps rows younger than 72h, sweeps older", async () => {
		if (!db) throw new Error("missing db");
		const mkRow = (txId: string, ageHours: number) => ({
			tx_id: txId,
			raw_tx: "0x00",
			type: "token_transfer",
			sender: "SP1",
			contract_id: null,
			function_name: null,
			function_args: null,
			received_at: new Date(Date.now() - ageHours * 3_600_000),
		});
		await db
			.insertInto("mempool_transactions")
			.values([mkRow("0xyoung", 48), mkRow("0xold", 96)])
			.execute();

		const deleted = await sweepStaleMempool(db, 72);
		expect(deleted).toBe(1); // only the 96h row
		expect(await count()).toBe(1);
	});

	test("mempoolDepth returns the current row count", async () => {
		if (!db) throw new Error("missing db");
		expect(await mempoolDepth(db)).toBe(0);
		await ingestMempoolTxs(db, [TOKEN_TRANSFER.raw_tx]);
		expect(await mempoolDepth(db)).toBe(1);
	});
});
