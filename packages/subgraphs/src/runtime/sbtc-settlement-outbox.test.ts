import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import type { Kysely } from "kysely";
import { emitSbtcSettlementOutbox } from "./trigger-evaluator.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db: Kysely<Database> = getDb();
const accountId = randomUUID();
const TX = "0xsettle-acc";
const HEIGHT = 970_000;
const SWEEP = "0xsettle-sweep";

async function setCursor(at: Date | null): Promise<void> {
	await db
		.insertInto("trigger_evaluator_state")
		.values({ id: true, last_processed_block: 0, last_settlement_scan_at: at })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({ last_settlement_scan_at: at }),
		)
		.execute();
}

async function readCursor(): Promise<Date | null> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("last_settlement_scan_at")
		.where("id", "=", true)
		.executeTakeFirst();
	return row?.last_settlement_scan_at ?? null;
}

/** Seed the Stacks accept event + its block + a confirmed settlement row. */
async function seedConfirmedSweep(confirmedAt: Date): Promise<void> {
	await db
		.insertInto("blocks")
		.values({
			height: HEIGHT,
			hash: `0x${HEIGHT}`,
			parent_hash: `0x${HEIGHT - 1}`,
			burn_block_height: HEIGHT + 10_000,
			burn_block_hash: `0xb${HEIGHT}`,
			timestamp: 1_700_000_000 + HEIGHT,
			canonical: true,
		})
		.onConflict((oc) => oc.column("height").doNothing())
		.execute();
	await db
		.insertInto("sbtc_events")
		.values({
			cursor: `${HEIGHT}:0`,
			block_height: HEIGHT,
			block_time: new Date("2026-06-01T00:00:00.000Z"),
			tx_id: TX,
			tx_index: 0,
			event_index: 0,
			topic: "withdrawal-accept",
			request_id: 555,
			amount: "12345",
			sender: "SP-SENDER",
			sweep_txid: SWEEP,
			source_cursor: `${HEIGHT}:0`,
		})
		.execute();
	await db
		.insertInto("sbtc_settlements")
		.values({
			sweep_txid: SWEEP,
			request_id: 555,
			btc_confirmations: 6,
			settlement_confirmed: true,
			block_hash: "0xbtcblk",
			block_height: 880_500,
			confirmed_at: confirmedAt,
		})
		.execute();
}

async function makeSub() {
	const { subscription } = await createSubscription(db, {
		accountId,
		kind: "chain",
		name: `swept-${randomUUID().slice(0, 8)}`,
		url: "https://webhook.site/xxx",
		triggers: [{ type: "sbtc_withdrawal_swept_confirmed" }],
	});
	return subscription;
}

beforeEach(async () => {
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
	await db
		.deleteFrom("sbtc_settlements")
		.where("sweep_txid", "=", SWEEP)
		.execute();
	await db.deleteFrom("sbtc_events").where("tx_id", "=", TX).execute();
	await db.deleteFrom("blocks").where("height", "=", HEIGHT).execute();
});

afterAll(async () => {
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
	await db
		.deleteFrom("sbtc_settlements")
		.where("sweep_txid", "=", SWEEP)
		.execute();
	await db.deleteFrom("sbtc_events").where("tx_id", "=", TX).execute();
	await db.deleteFrom("blocks").where("height", "=", HEIGHT).execute();
});

describe("emitSbtcSettlementOutbox", () => {
	it("fast-forwards an uninitialized cursor without emitting", async () => {
		await setCursor(null);
		const sub = await makeSub();
		await seedConfirmedSweep(new Date(Date.now() + 60_000));

		const now = new Date();
		const n = await emitSbtcSettlementOutbox(db, [sub], { now });
		expect(n).toBe(0);
		expect((await readCursor())?.getTime()).toBe(now.getTime());
	});

	it("emits once for a sweep confirmed after the cursor and after the sub", async () => {
		await setCursor(new Date(Date.now() - 86_400_000)); // 1 day ago
		const sub = await makeSub();
		// confirmed after the sub was created (forward-only) and after the cursor
		await seedConfirmedSweep(new Date(Date.now() + 60_000));

		const n = await emitSbtcSettlementOutbox(db, [sub]);
		expect(n).toBe(1);

		const rows = await db
			.selectFrom("subscription_outbox")
			.select(["event_type", "dedup_key"])
			.where("subscription_id", "=", sub.id)
			.execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.event_type).toBe(
			"chain.sbtc_withdrawal_swept_confirmed.apply",
		);
		expect(rows[0]?.dedup_key).toBe(`settlement:${sub.id}:${SWEEP}`);
	});

	it("forward-only: skips a sweep confirmed before the subscription existed", async () => {
		await setCursor(new Date(Date.now() - 86_400_000));
		const sub = await makeSub();
		// confirmed BEFORE the sub was created → must not deliver
		await seedConfirmedSweep(new Date(Date.now() - 60_000));

		const n = await emitSbtcSettlementOutbox(db, [sub]);
		expect(n).toBe(0);
		const rows = await db
			.selectFrom("subscription_outbox")
			.selectAll()
			.where("subscription_id", "=", sub.id)
			.execute();
		expect(rows).toHaveLength(0);
	});

	it("does not double-fire on re-scan (cursor advance + dedup backstop)", async () => {
		await setCursor(new Date(Date.now() - 86_400_000));
		const sub = await makeSub();
		await seedConfirmedSweep(new Date(Date.now() + 60_000));

		expect(await emitSbtcSettlementOutbox(db, [sub])).toBe(1);
		// Second pass: cursor advanced past confirmed_at → nothing scanned.
		expect(await emitSbtcSettlementOutbox(db, [sub])).toBe(0);

		// Even if the cursor is forced back, the dedup key blocks a re-delivery.
		await setCursor(new Date(Date.now() - 86_400_000));
		await emitSbtcSettlementOutbox(db, [sub]);
		const count = await db
			.selectFrom("subscription_outbox")
			.select((eb) => eb.fn.countAll<number>().as("c"))
			.where("subscription_id", "=", sub.id)
			.executeTakeFirstOrThrow();
		expect(Number(count.c)).toBe(1);
	});
});
