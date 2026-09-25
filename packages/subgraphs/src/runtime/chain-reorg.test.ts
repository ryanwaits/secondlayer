import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { InsertWebhookOutbox, OutboxStatus } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { handleChainReorg } from "./chain-reorg.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();
const accountId = randomUUID();

afterAll(async () => {
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

beforeEach(async () => {
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

async function makeSub(): Promise<string> {
	const { webhook } = await createWebhook(db, {
		accountId,
		name: `reorg-${randomUUID()}`,
		kind: "chain",
		triggers: [{ type: "contract_call" }],
		url: "https://webhook.site/reorg",
	});
	return webhook.id;
}

async function insertApply(
	webhookId: string,
	height: number,
	txId: string,
	status: OutboxStatus,
	opts?: { attempt?: number; lockedUntil?: Date },
): Promise<void> {
	const row: InsertWebhookOutbox = {
		webhook_id: webhookId,
		kind: "chain",
		subgraph_name: null,
		table_name: null,
		block_height: height,
		tx_id: txId,
		row_pk: { tx_id: txId, event_index: -1 },
		event_type: "chain.contract_call.apply",
		payload: {
			action: "apply",
			block_hash: `0x${height}`,
			block_height: height,
			tx_id: txId,
			canonical: true,
			trigger: "contract_call",
			event: { tx_id: txId, contract_id: "SP1.amm" },
		},
		dedup_key: `chain:${webhookId}:${txId}:-1:0x${height}`,
		status,
		attempt: opts?.attempt,
		locked_until: opts?.lockedUntil,
	};
	await db.insertInto("webhook_outbox").values(row).execute();
}

async function setCursor(height: number): Promise<void> {
	await db
		.updateTable("trigger_evaluator_state")
		.set({ last_processed_block: height })
		.where("id", "=", true)
		.execute();
}

async function cursor(): Promise<number> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("last_processed_block")
		.where("id", "=", true)
		.executeTakeFirstOrThrow();
	return Number(row.last_processed_block);
}

async function rows(webhookId: string) {
	return db
		.selectFrom("webhook_outbox")
		.selectAll()
		.where("webhook_id", "=", webhookId)
		.execute();
}

describe("handleChainReorg", () => {
	it("drops pending applies, rolls back delivered, rewinds the cursor, idempotently", async () => {
		const sub = await makeSub();
		await insertApply(sub, 99, "0xbelow", "delivered"); // below fork — untouched
		await insertApply(sub, 100, "0xa", "delivered"); // orphaned, delivered
		await insertApply(sub, 101, "0xb", "delivered"); // orphaned, delivered
		await insertApply(sub, 102, "0xc", "pending"); // orphaned, never sent
		await setCursor(105);

		await handleChainReorg(100, db);

		const all = await rows(sub);
		// Pending orphaned apply dropped.
		expect(all.find((r) => r.tx_id === "0xc")).toBeUndefined();
		// Below-fork apply untouched.
		expect(all.find((r) => r.tx_id === "0xbelow")).toBeDefined();
		// Delivered orphaned applies remain (the rollback references them).
		expect(
			all.filter((r) => r.event_type === "chain.contract_call.apply"),
		).toHaveLength(3);

		// Exactly one rollback row carrying the two orphaned delivered events.
		const rollbacks = all.filter(
			(r) => r.event_type === "chain.reorg.rollback",
		);
		expect(rollbacks).toHaveLength(1);
		const payload = rollbacks[0].payload as {
			action: string;
			fork_point_height: number;
			orphaned: { tx_id: string }[];
		};
		expect(payload.action).toBe("rollback");
		expect(payload.fork_point_height).toBe(100);
		expect(payload.orphaned.map((o) => o.tx_id).sort()).toEqual(["0xa", "0xb"]);

		// Cursor rewound to forkHeight - 1.
		expect(await cursor()).toBe(99);

		// Idempotent: re-applying the same reorg adds no new rollback, cursor stays.
		await handleChainReorg(100, db);
		const after = await rows(sub);
		expect(
			after.filter((r) => r.event_type === "chain.reorg.rollback"),
		).toHaveLength(1);
		expect(await cursor()).toBe(99);
	});

	it("does not rewind the cursor below its current position", async () => {
		const sub = await makeSub();
		await insertApply(sub, 100, "0xa", "delivered");
		await setCursor(50); // already behind the fork

		await handleChainReorg(100, db);
		// Cursor < forkHeight → not rewound forward or backward past itself.
		expect(await cursor()).toBe(50);
	});

	it("does not delete a claimed-but-unsettled row (locked_until in the future) — rolls it back and marks it dead", async () => {
		const sub = await makeSub();
		const lockedUntil = new Date(Date.now() + 5 * 60_000); // emitter claimed it, POST maybe in flight
		await insertApply(sub, 100, "0xclaimed", "pending", { lockedUntil });
		await setCursor(105);

		await handleChainReorg(100, db);

		const all = await rows(sub);
		const row = all.find((r) => r.tx_id === "0xclaimed");
		// (a) not deleted
		expect(row).toBeDefined();
		// (c) marked dead so it never retries into the orphaned fork
		expect(row?.status).toBe("dead");
		expect(row?.last_error).toBe("orphaned by reorg at 100");
		expect(row?.locked_until).toBeNull();

		// (b) rollback envelope includes its tx_id
		const rollback = all.find((r) => r.event_type === "chain.reorg.rollback");
		expect(rollback).toBeDefined();
		const payload = rollback?.payload as { orphaned: { tx_id: string }[] };
		expect(payload.orphaned.map((o) => o.tx_id)).toEqual(["0xclaimed"]);
	});

	it("does not delete a row with a prior attempt (attempt=1, unlocked) — rolls it back and marks it dead", async () => {
		const sub = await makeSub();
		await insertApply(sub, 100, "0xretried", "pending", { attempt: 1 });
		await setCursor(105);

		await handleChainReorg(100, db);

		const all = await rows(sub);
		const row = all.find((r) => r.tx_id === "0xretried");
		expect(row).toBeDefined();
		expect(row?.status).toBe("dead");
		expect(row?.last_error).toBe("orphaned by reorg at 100");

		const rollback = all.find((r) => r.event_type === "chain.reorg.rollback");
		expect(rollback).toBeDefined();
		const payload = rollback?.payload as { orphaned: { tx_id: string }[] };
		expect(payload.orphaned.map((o) => o.tx_id)).toEqual(["0xretried"]);
	});
});
