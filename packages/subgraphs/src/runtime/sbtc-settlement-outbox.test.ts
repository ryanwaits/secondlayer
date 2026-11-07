import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import type { Kysely } from "kysely";
import { emitSbtcSettlementOutbox } from "./trigger-evaluator.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db: Kysely<Database> = getDb();
const accountId = randomUUID();
// By id, not account: OSS mode stores every webhook with account_id "".
const webhookIds: string[] = [];
const TX = "0xsettle-acc";
const HEIGHT = 970_000;
const SWEEP = "0xsettle-sweep";
const LATE = {
	sweep: "0xsettle-sweep-late",
	tx: "0xsettle-acc-late",
	height: 970_001,
	requestId: 556,
};

async function setCursor(at: Date | null): Promise<void> {
	await db
		.insertInto("trigger_evaluator_state")
		.values({
			id: true,
			last_processed_block: 0,
			last_settlement_scan_at: at,
			last_settlement_scan_seq: null,
		})
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({
				last_settlement_scan_at: at,
				last_settlement_scan_seq: null,
			}),
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

/** Seed a Stacks accept event + its block + a confirmed settlement row. */
async function seedConfirmedSweep(
	confirmedAt: Date,
	ids: { sweep: string; tx: string; height: number; requestId: number } = {
		sweep: SWEEP,
		tx: TX,
		height: HEIGHT,
		requestId: 555,
	},
): Promise<void> {
	await db
		.insertInto("blocks")
		.values({
			height: ids.height,
			hash: `0x${ids.height}`,
			parent_hash: `0x${ids.height - 1}`,
			burn_block_height: ids.height + 10_000,
			burn_block_hash: `0xb${ids.height}`,
			timestamp: 1_700_000_000 + ids.height,
			canonical: true,
		})
		.onConflict((oc) => oc.column("height").doNothing())
		.execute();
	await db
		.insertInto("sbtc_events")
		.values({
			cursor: `${ids.height}:0`,
			block_height: ids.height,
			block_time: new Date("2026-06-01T00:00:00.000Z"),
			tx_id: ids.tx,
			tx_index: 0,
			event_index: 0,
			topic: "withdrawal-accept",
			request_id: ids.requestId,
			amount: "12345",
			sender: "SP-SENDER",
			sweep_txid: ids.sweep,
			source_cursor: `${ids.height}:0`,
		})
		.execute();
	await db
		.insertInto("sbtc_settlements")
		.values({
			sweep_txid: ids.sweep,
			request_id: ids.requestId,
			btc_confirmations: 6,
			settlement_confirmed: true,
			block_hash: "0xbtcblk",
			block_height: 880_500,
			confirmed_at: confirmedAt,
		})
		.execute();
}

async function deleteCreatedWebhooks(): Promise<void> {
	const ids = webhookIds.splice(0);
	if (ids.length > 0)
		await db.deleteFrom("webhooks").where("id", "in", ids).execute();
}

async function deleteSeededChain(): Promise<void> {
	await db
		.deleteFrom("sbtc_settlements")
		.where("sweep_txid", "in", [SWEEP, LATE.sweep])
		.execute();
	await db
		.deleteFrom("sbtc_events")
		.where("tx_id", "in", [TX, LATE.tx])
		.execute();
	await db
		.deleteFrom("blocks")
		.where("height", "in", [HEIGHT, LATE.height])
		.execute();
}

async function makeSub() {
	const { webhook } = await createWebhook(db, {
		accountId,
		name: `swept-${randomUUID().slice(0, 8)}`,
		url: "https://webhook.site/xxx",
		triggers: [{ type: "sbtc_withdrawal_swept_confirmed" }],
	});
	webhookIds.push(webhook.id);
	return webhook;
}

beforeEach(async () => {
	await deleteCreatedWebhooks();
	await deleteSeededChain();
});

afterAll(async () => {
	await deleteCreatedWebhooks();
	await deleteSeededChain();
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
			.selectFrom("webhook_outbox")
			.select(["event_type", "dedup_key", "payload", "block_time"])
			.where("webhook_id", "=", sub.id)
			.execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.event_type).toBe(
			"chain.sbtc_withdrawal_swept_confirmed.apply",
		);
		const anchorTime = new Date((1_700_000_000 + HEIGHT) * 1000).toISOString();
		expect((rows[0]?.payload as Record<string, unknown>).block_time).toBe(
			anchorTime,
		);
		expect(rows[0]?.block_time?.toISOString()).toBe(anchorTime);
		expect(rows[0]?.dedup_key).toBe(`settlement:${sub.id}:${SWEEP}`);
	});

	it("resumes from the scanned row's seq instead of the confirmed_at floor", async () => {
		await setCursor(new Date(Date.now() - 86_400_000));
		const sub = await makeSub();
		await seedConfirmedSweep(new Date(Date.now() + 60_000));
		expect(await emitSbtcSettlementOutbox(db, [sub])).toBe(1);

		const seq = await db
			.selectFrom("sbtc_settlements")
			.select("seq")
			.where("sweep_txid", "=", SWEEP)
			.executeTakeFirstOrThrow();
		const state = await db
			.selectFrom("trigger_evaluator_state")
			.select("last_settlement_scan_seq")
			.where("id", "=", true)
			.executeTakeFirstOrThrow();
		expect(Number(state.last_settlement_scan_seq)).toBe(Number(seq.seq));
	});

	it("forward-only: skips a sweep confirmed before the webhook existed", async () => {
		await setCursor(new Date(Date.now() - 86_400_000));
		const sub = await makeSub();
		// confirmed BEFORE the sub was created → must not deliver
		await seedConfirmedSweep(new Date(Date.now() - 60_000));

		const n = await emitSbtcSettlementOutbox(db, [sub]);
		expect(n).toBe(0);
		const rows = await db
			.selectFrom("webhook_outbox")
			.selectAll()
			.where("webhook_id", "=", sub.id)
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
			.selectFrom("webhook_outbox")
			.select((eb) => eb.fn.countAll<number>().as("c"))
			.where("webhook_id", "=", sub.id)
			.executeTakeFirstOrThrow();
		expect(Number(count.c)).toBe(1);
	});

	it("delivers a sweep that commits after a later-stamped one with an earlier confirmed_at", async () => {
		await setCursor(new Date(Date.now() - 86_400_000));
		const sub = await makeSub();
		await seedConfirmedSweep(new Date(Date.now() + 60_000));
		expect(await emitSbtcSettlementOutbox(db, [sub])).toBe(1);

		// Written by a clock that runs behind, so its confirmed_at is older than
		// the watermark the first scan left behind.
		await seedConfirmedSweep(new Date(Date.now() + 30_000), LATE);

		expect(await emitSbtcSettlementOutbox(db, [sub])).toBe(1);
		const dedupKeys = (
			await db
				.selectFrom("webhook_outbox")
				.select("dedup_key")
				.where("webhook_id", "=", sub.id)
				.execute()
		)
			.map((r) => r.dedup_key)
			.sort();
		expect(dedupKeys).toEqual(
			[
				`settlement:${sub.id}:${LATE.sweep}`,
				`settlement:${sub.id}:${SWEEP}`,
			].sort(),
		);
	});
});
