import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { verifyTransferByTxId } from "./transfer-by-txid.ts";

const HAS_DB = !!process.env.DATABASE_URL;

type RowOverrides = {
	cursor: string;
	tx_id: string;
	event_type: "ft_transfer" | "stx_transfer";
	contract_id: string | null;
	asset_identifier: string | null;
	recipient: string;
	amount: string;
	canonical?: boolean;
};

function row(o: RowOverrides) {
	const [bh, ei] = o.cursor.split(":");
	return {
		cursor: o.cursor,
		block_height: Number(bh),
		tx_id: o.tx_id,
		tx_index: 0,
		event_index: Number(ei),
		event_type: o.event_type,
		contract_id: o.contract_id,
		asset_identifier: o.asset_identifier,
		sender: "SP1SENDER",
		recipient: o.recipient,
		amount: o.amount,
		canonical: o.canonical ?? true,
		source_cursor: o.cursor,
	};
}

describe.skipIf(!HAS_DB)("verifyTransferByTxId", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
		await db
			.insertInto("decoded_events")
			.values([
				row({
					cursor: "9000:0",
					tx_id: "0xft",
					event_type: "ft_transfer",
					contract_id: "SP1.token",
					asset_identifier: "SP1.token::coin",
					recipient: "SP2RECIP",
					amount: "1000",
				}),
				row({
					cursor: "9001:0",
					tx_id: "0xstx",
					event_type: "stx_transfer",
					contract_id: null,
					asset_identifier: null,
					recipient: "SP2RECIP",
					amount: "500",
				}),
				row({
					cursor: "9002:0",
					tx_id: "0xorphan",
					event_type: "ft_transfer",
					contract_id: "SP1.token",
					asset_identifier: "SP1.token::coin",
					recipient: "SP2RECIP",
					amount: "1000",
					canonical: false,
				}),
			])
			.execute();
	});

	test("matches a canonical SIP-010 transfer by txid + recipient + amount + asset", async () => {
		const match = await verifyTransferByTxId({
			txid: "0xft",
			recipient: "SP2RECIP",
			amount: "1000",
			asset: { kind: "sip010", assetIdentifier: "SP1.token::coin" },
			db: db ?? undefined,
		});
		expect(match).toMatchObject({ event_type: "ft_transfer", tx_id: "0xft" });
	});

	test("matches a canonical STX transfer", async () => {
		const match = await verifyTransferByTxId({
			txid: "0xstx",
			recipient: "SP2RECIP",
			amount: "500",
			asset: { kind: "stx" },
			db: db ?? undefined,
		});
		expect(match).toMatchObject({ event_type: "stx_transfer", tx_id: "0xstx" });
	});

	test("returns null on amount mismatch", async () => {
		expect(
			await verifyTransferByTxId({
				txid: "0xft",
				recipient: "SP2RECIP",
				amount: "999",
				asset: { kind: "sip010", assetIdentifier: "SP1.token::coin" },
				db: db ?? undefined,
			}),
		).toBeNull();
	});

	test("returns null on recipient mismatch", async () => {
		expect(
			await verifyTransferByTxId({
				txid: "0xft",
				recipient: "SPWRONG",
				amount: "1000",
				asset: { kind: "sip010", assetIdentifier: "SP1.token::coin" },
				db: db ?? undefined,
			}),
		).toBeNull();
	});

	test("returns null on wrong asset identifier", async () => {
		expect(
			await verifyTransferByTxId({
				txid: "0xft",
				recipient: "SP2RECIP",
				amount: "1000",
				asset: { kind: "sip010", assetIdentifier: "SP1.token::other" },
				db: db ?? undefined,
			}),
		).toBeNull();
	});

	test("does NOT match a non-canonical (orphaned) transfer", async () => {
		expect(
			await verifyTransferByTxId({
				txid: "0xorphan",
				recipient: "SP2RECIP",
				amount: "1000",
				asset: { kind: "sip010", assetIdentifier: "SP1.token::coin" },
				db: db ?? undefined,
			}),
		).toBeNull();
	});
});
