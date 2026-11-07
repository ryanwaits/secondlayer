import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { InsertWebhookOutbox, OutboxStatus } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { handleChainReorg, reorgScope } from "./chain-reorg.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();
const accountId = randomUUID();
// OSS/tenant mode stores every webhook under the empty account id regardless
// of what's passed (`createWebhook`: `isPlatformMode() ? input.accountId :
// ""`), so cleanup keyed on `account_id = accountId` is a no-op there and
// leaks rows into the shared dev DB across every local test run. Tag the
// webhook's NAME with this run's random id instead — unique per process
// (including concurrent local runs) regardless of platform mode.
const NAME_PREFIX = `reorg-${accountId}-`;

afterAll(async () => {
	await db
		.deleteFrom("webhooks")
		.where("name", "like", `${NAME_PREFIX}%`)
		.execute();
});

beforeEach(async () => {
	await db
		.deleteFrom("webhooks")
		.where("name", "like", `${NAME_PREFIX}%`)
		.execute();
});

async function makeSub(): Promise<string> {
	const { webhook } = await createWebhook(db, {
		accountId,
		name: `${NAME_PREFIX}${randomUUID()}`,
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
	opts?: { attempt?: number; lockedUntil?: Date; blockHash?: string },
): Promise<void> {
	const blockHash = opts?.blockHash ?? `0x${height}`;
	const row: InsertWebhookOutbox = {
		webhook_id: webhookId,
		kind: "chain",
		block_height: height,
		block_hash: blockHash,
		tx_id: txId,
		row_pk: { tx_id: txId, event_index: -1 },
		event_type: "chain.contract_call.apply",
		payload: {
			action: "apply",
			block_hash: blockHash,
			block_height: height,
			tx_id: txId,
			canonical: true,
			trigger: "contract_call",
			event: { tx_id: txId, contract_id: "SP1.amm" },
		},
		dedup_key: `chain:${webhookId}:${txId}:-1:${blockHash}`,
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

async function setBitcoinCursor(cursorText: string): Promise<void> {
	await db
		.updateTable("trigger_evaluator_state")
		.set({ bitcoin_last_cursor: cursorText })
		.where("id", "=", true)
		.execute();
}

async function bitcoinCursor(): Promise<string | null> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("bitcoin_last_cursor")
		.where("id", "=", true)
		.executeTakeFirstOrThrow();
	return row.bitcoin_last_cursor;
}

async function insertRuneApply(
	webhookId: string,
	height: number,
	txId: string,
	status: OutboxStatus,
): Promise<void> {
	const row: InsertWebhookOutbox = {
		webhook_id: webhookId,
		kind: "chain",
		block_height: height,
		tx_id: txId,
		row_pk: { tx_id: txId, event_index: 0 },
		event_type: "chain.rune_transfer.apply",
		payload: {
			action: "apply",
			chain: "bitcoin",
			block_hash: `0xbtc${height}`,
			block_height: height,
			tx_id: txId,
			event_index: 0,
			trigger: "rune_transfer",
			rune_id: "840000:3",
			event: { amount: "1000" },
		},
		dedup_key: `btc:${webhookId}:${txId}:0:0xbtc${height}`,
		status,
	};
	await db.insertInto("webhook_outbox").values(row).execute();
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

describe("handleChainReorg — chain scoping (plan 060)", () => {
	it("a Bitcoin reorg at a much lower height does not touch Stacks apply rows or the Stacks cursor", async () => {
		const sub = await makeSub();
		// Stacks heights (~9.06M) are numerically far above a Bitcoin fork
		// height (~968k) — the bug this guards against would have swept this
		// row up under a bare `block_height >= forkHeight` check.
		await insertApply(sub, 9_060_050, "0xstacks", "delivered");
		await insertRuneApply(sub, 968_000, "0xbtc", "delivered");
		await setCursor(9_060_100);
		await setBitcoinCursor("968100:0");

		await handleChainReorg(968_000, db, "bitcoin");

		const all = await rows(sub);
		// Stacks apply row completely untouched.
		const stacksRow = all.find((r) => r.tx_id === "0xstacks");
		expect(stacksRow).toBeDefined();
		expect(stacksRow?.status).toBe("delivered");
		expect(await cursor()).toBe(9_060_100); // Stacks cursor unchanged

		// Bitcoin rune apply row rolled back.
		const rollbacks = all.filter(
			(r) => r.event_type === "chain.reorg.rollback",
		);
		expect(rollbacks).toHaveLength(1);
		expect(rollbacks[0]?.dedup_key).toBe(`btcreorg:${sub}:968000`);
		const payload = rollbacks[0]?.payload as {
			chain?: string;
			orphaned: { tx_id: string }[];
		};
		expect(payload.chain).toBe("bitcoin");
		expect(payload.orphaned.map((o) => o.tx_id)).toEqual(["0xbtc"]);
		// Rewound to the end of the block below the fork, so event 968000:0 is re-read.
		expect(await bitcoinCursor()).toBe("967999:2147483647");
	});

	it("a Bitcoin rewind leaves the cursor strictly before event 0 at the fork height", async () => {
		await makeSub();
		await setBitcoinCursor("968100:5");

		await handleChainReorg(968_000, db, "bitcoin");

		// Loads read strictly after the cursor, so it must sort before 968000:0.
		const [height, index] =
			(await bitcoinCursor())?.split(":").map(Number) ?? [];
		expect(height).toBe(967_999);
		expect(index).toBeGreaterThan(0);
		expect(height).toBeLessThan(968_000);
	});

	it("a Stacks reorg does not touch Bitcoin rune apply rows, even at an overlapping height", async () => {
		const sub = await makeSub();
		await insertApply(sub, 100, "0xstacks", "delivered");
		await insertRuneApply(sub, 100, "0xbtc", "delivered");
		await setCursor(105);
		await setBitcoinCursor("105:0");

		await handleChainReorg(100, db); // chain defaults to "stacks"

		const all = await rows(sub);
		// Bitcoin rune apply row completely untouched.
		const btcRow = all.find((r) => r.tx_id === "0xbtc");
		expect(btcRow).toBeDefined();
		expect(btcRow?.status).toBe("delivered");
		expect(await bitcoinCursor()).toBe("105:0"); // Bitcoin cursor unchanged

		// Stacks apply row rolled back, Stacks cursor rewound.
		const rollbacks = all.filter(
			(r) => r.event_type === "chain.reorg.rollback",
		);
		expect(rollbacks).toHaveLength(1);
		expect(rollbacks[0]?.dedup_key).toBe(`chainreorg:${sub}:100`);
		const payload = rollbacks[0]?.payload as {
			chain?: string;
			orphaned: { tx_id: string }[];
		};
		expect(payload.chain).toBeUndefined();
		expect(payload.orphaned.map((o) => o.tx_id)).toEqual(["0xstacks"]);
		expect(await cursor()).toBe(99);
	});
});

type RollbackPayload = {
	orphaned: {
		tx_id: string;
		block_hash: string | null;
		block_height: number;
	}[];
};

function rollbackEntries(
	all: Awaited<ReturnType<typeof rows>>,
): RollbackPayload["orphaned"] {
	return all
		.filter((r) => r.event_type === "chain.reorg.rollback")
		.flatMap((r) => (r.payload as RollbackPayload).orphaned);
}

describe("handleChainReorg scoped to the orphaned blocks", () => {
	it("leaves delivered applies above the orphaned range untouched", async () => {
		const sub = await makeSub();
		for (let h = 94; h <= 108; h++) {
			await insertApply(sub, h, `0xtx${h}`, "delivered");
		}
		await setCursor(108);

		await handleChainReorg(94, db, "stacks", {
			orphanedToHeight: 104,
			orphanedBlockHash: "0x94",
		});

		const all = await rows(sub);
		expect(rollbackEntries(all).map((o) => o.block_height)).toEqual(
			Array.from({ length: 11 }, (_, i) => 94 + i),
		);
		for (const h of [105, 106, 107, 108]) {
			expect(
				all.find((r) => r.tx_id === `0xtx${h}`)?.rolled_back_at,
			).toBeNull();
		}
	});

	it("keeps a replacement block's apply at the fork height and rolls back only the named block", async () => {
		const sub = await makeSub();
		await insertApply(sub, 100, "0xold", "delivered", {
			blockHash: "0xold100",
		});
		await insertApply(sub, 100, "0xnew", "delivered", {
			blockHash: "0xnew100",
		});

		await handleChainReorg(100, db, "stacks", {
			orphanedToHeight: 100,
			orphanedBlockHash: "0xold100",
		});

		const all = await rows(sub);
		expect(rollbackEntries(all).map((o) => o.tx_id)).toEqual(["0xold"]);
		expect(all.find((r) => r.tx_id === "0xnew")?.rolled_back_at).toBeNull();
	});

	it("rolls back each orphaned event once when one reorg arrives as a row per height", async () => {
		const sub = await makeSub();
		for (let h = 94; h <= 108; h++) {
			await insertApply(sub, h, `0xtx${h}`, "delivered", {
				blockHash: `0xold${h}`,
			});
		}
		await setCursor(108);

		// The indexer unwinds the fork one height at a time, tip first.
		for (let h = 104; h >= 94; h--) {
			await handleChainReorg(
				h,
				db,
				"stacks",
				reorgScope({
					id: `r${h}`,
					detected_at: new Date().toISOString(),
					fork_point_height: h,
					orphaned_range: { from: `${h}:0`, to: `${h}:0` },
					new_canonical_tip: `${h}:0`,
					old_index_block_hash: `0xold${h}`,
				}),
			);
		}

		const all = await rows(sub);
		expect(
			rollbackEntries(all)
				.map((e) => e.tx_id)
				.sort(),
		).toEqual(Array.from({ length: 11 }, (_, i) => `0xtx${94 + i}`).sort());
		for (let h = 105; h <= 108; h++) {
			expect(
				all.find((r) => r.tx_id === `0xtx${h}`)?.rolled_back_at,
			).toBeNull();
		}
		expect(await cursor()).toBe(93);

		// A surviving tx re-applies under its new block hash: the new key does
		// not collide with the recalled row, so it delivers.
		await insertApply(sub, 94, "0xtx94", "pending", { blockHash: "0xnew94" });
		const pending = (await rows(sub)).filter(
			(r) => r.status === "pending" && r.event_type.endsWith(".apply"),
		);
		expect(pending.map((r) => r.tx_id)).toEqual(["0xtx94"]);
	});

	it("does not recall a delivered apply a rollback already recalled", async () => {
		const sub = await makeSub();
		await insertApply(sub, 100, "0xa", "delivered");

		await handleChainReorg(100, db);
		await handleChainReorg(99, db);

		expect(rollbackEntries(await rows(sub))).toHaveLength(1);
	});

	it("names the block hash and height on each orphaned entry, including rows written before the column existed", async () => {
		const sub = await makeSub();
		await insertApply(sub, 100, "0xa", "delivered", { blockHash: "0xhash100" });
		await insertApply(sub, 101, "0xlegacy", "delivered", {
			blockHash: "0xlegacy101",
		});
		await db
			.updateTable("webhook_outbox")
			.set({ block_hash: null })
			.where("webhook_id", "=", sub)
			.where("tx_id", "=", "0xlegacy")
			.execute();

		await handleChainReorg(100, db);

		expect(
			rollbackEntries(await rows(sub)).map((o) => [
				o.tx_id,
				o.block_hash,
				o.block_height,
			]),
		).toEqual([
			["0xa", "0xhash100", 100],
			["0xlegacy", "0xlegacy101", 101],
		]);
	});
});

describe("reorgScope", () => {
	const base = {
		id: "r",
		detected_at: "2026-01-01T00:00:00Z",
		new_canonical_tip: "100:0",
	};

	it("reads the orphaned height and hash off a Streams reorg row", () => {
		expect(
			reorgScope({
				...base,
				fork_point_height: 100,
				orphaned_range: { from: "100:0", to: "104:7" },
				old_index_block_hash: "0xabc",
			}),
		).toEqual({ orphanedToHeight: 104, orphanedBlockHash: "0xabc" });
	});

	it("returns no scope for a malformed range so the handler falls back to the height rule", () => {
		expect(
			reorgScope({
				...base,
				fork_point_height: 100,
				orphaned_range: { from: "100:0", to: "nope" },
			}),
		).toBeUndefined();
	});
});
