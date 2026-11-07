import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import type {
	IndexHttpClient,
	StreamsReorgRow,
} from "@secondlayer/shared/index-http";
import type { RuneStreamsEvent } from "@secondlayer/shared/streams-rows";
import {
	type BitcoinStreamsSource,
	runBitcoinEvaluatorOnce,
} from "./bitcoin-trigger-evaluator.ts";
import { handleChainReorg } from "./chain-reorg.ts";
import { pollReorgsOnce } from "./streams-reorg-poll.ts";
import { runEvaluatorOnce } from "./trigger-evaluator-loop.ts";
import { gateChainReorgOnLeader } from "./webhook-leader.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();
const NAME_PREFIX = `reorg-race-${randomUUID()}-`;

async function deleteTestWebhooks(): Promise<void> {
	await db
		.deleteFrom("webhooks")
		.where("name", "like", `${NAME_PREFIX}%`)
		.execute();
}

afterAll(deleteTestWebhooks);

async function outboxHeights(webhookId: string): Promise<number[]> {
	const rows = await db
		.selectFrom("webhook_outbox")
		.select("block_height")
		.where("webhook_id", "=", webhookId)
		.where("event_type", "like", "chain.%.apply")
		.execute();
	return rows.map((r) => Number(r.block_height));
}

describe("a reorg that lands between loading a batch and emitting it", () => {
	const FROM = 5000;
	const FORK = FROM + 2;
	const TIP = FROM + 4;
	const savedEnv = {
		SUBGRAPH_SOURCE: process.env.SUBGRAPH_SOURCE,
		SUBGRAPH_INDEX_API_URL: process.env.SUBGRAPH_INDEX_API_URL,
	};
	let webhookId: string;

	async function setCursor(height: number): Promise<void> {
		await db
			.updateTable("trigger_evaluator_state")
			.set({ last_processed_block: height })
			.where("id", "=", true)
			.execute();
	}

	/** A hosted Index whose event read runs `onEventsRead` first, i.e. after the
	 *  evaluator snapshotted its state and before it emits anything. */
	function fakeHttp(onEventsRead: () => Promise<void>): IndexHttpClient {
		return {
			getIndexTip: async () => TIP,
			getIndexSourceTip: async () => TIP,
			getDecodedHeights: () => ({ stx_transfer: TIP }),
			waitIsSupported: () => true,
			walkBlocks: async (from: number, to: number) => {
				const rows = [];
				for (let h = from; h <= to; h++) {
					rows.push({
						block_height: h,
						block_hash: `0xold${h}`,
						parent_hash: `0xold${h - 1}`,
						burn_block_height: h,
						burn_block_hash: null,
						block_time: "2026-01-01T00:00:00.000Z",
					});
				}
				return rows;
			},
			walkTransactions: async () => [],
			walkEvents: async (_type: string, from: number, to: number) => {
				await onEventsRead();
				return FORK >= from && FORK <= to
					? [
							{
								event_type: "stx_transfer",
								block_height: FORK,
								tx_id: "0xtx-orphan-fork",
								tx_index: 0,
								event_index: 0,
								contract_id: null,
								tx_sender: "SP1",
								tx_type: "token_transfer",
								tx_status: "success",
								sender: "SP1",
								recipient: "SP2",
								amount: "1000",
								memo: null,
							},
						]
					: [];
			},
		} as unknown as IndexHttpClient;
	}

	beforeEach(async () => {
		await deleteTestWebhooks();
		process.env.SUBGRAPH_SOURCE = "streams-index";
		process.env.SUBGRAPH_INDEX_API_URL = "http://index.invalid";
		const { webhook } = await createWebhook(db, {
			accountId: randomUUID(),
			name: `${NAME_PREFIX}${randomUUID()}`,
			triggers: [{ type: "stx_transfer" }],
			url: "https://webhook.site/race",
		});
		webhookId = webhook.id;
		await setCursor(FROM - 1);
	});

	afterEach(async () => {
		await deleteTestWebhooks();
		await setCursor(0);
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	it("leaves no orphan-fork apply rows for the Stacks evaluator", async () => {
		let reorged = false;
		await runEvaluatorOnce(db, {
			httpClient: fakeHttp(async () => {
				if (reorged) return;
				reorged = true;
				await handleChainReorg(FORK, db);
			}),
		});

		expect(reorged).toBe(true);
		expect(await outboxHeights(webhookId)).toEqual([]);
		// The batch was abandoned, not advanced past the fork.
		const cursor = await db
			.selectFrom("trigger_evaluator_state")
			.select("last_processed_block")
			.where("id", "=", true)
			.executeTakeFirstOrThrow();
		expect(Number(cursor.last_processed_block)).toBeLessThan(FORK);
	});

	it("emits the batch normally when no reorg lands", async () => {
		await runEvaluatorOnce(db, { httpClient: fakeHttp(async () => {}) });

		expect(await outboxHeights(webhookId)).toEqual([FORK]);
	});
});

describe("a Runes reorg between loading a page and emitting it", () => {
	const FORK = 968_100;
	let webhookId: string;

	async function setBitcoinCursor(cursor: string | null): Promise<void> {
		await db
			.updateTable("trigger_evaluator_state")
			.set({ bitcoin_last_cursor: cursor })
			.where("id", "=", true)
			.execute();
	}

	const orphanEvent: RuneStreamsEvent = {
		cursor: `${FORK}:0`,
		chain: "bitcoin",
		block_height: FORK,
		block_hash: "0xbtcold",
		tx_id: "0xtx-orphan-rune",
		tx_index: 0,
		event_index: 0,
		event_type: "rune_etch",
		rune_id: "840000:3",
		payload: { amount: "1" },
	};

	beforeEach(async () => {
		await deleteTestWebhooks();
		const { webhook } = await createWebhook(db, {
			accountId: randomUUID(),
			name: `${NAME_PREFIX}${randomUUID()}`,
			triggers: [{ type: "rune_etch" }],
			url: "https://webhook.site/race-rune",
		});
		webhookId = webhook.id;
		await setBitcoinCursor(`${FORK - 1}:0`);
	});

	afterEach(async () => {
		await deleteTestWebhooks();
		await setBitcoinCursor(null);
	});

	it("leaves no orphan-fork apply rows", async () => {
		let reorged = false;
		const source: BitcoinStreamsSource = {
			getTip: async () => FORK + 5,
			loadEvents: async () => {
				if (!reorged) {
					reorged = true;
					await handleChainReorg(FORK, db, "bitcoin");
				}
				return { events: [orphanEvent], nextCursor: `${FORK}:0` };
			},
		};

		await runBitcoinEvaluatorOnce(db, source);

		expect(reorged).toBe(true);
		expect(await outboxHeights(webhookId)).toEqual([]);
	});
});

describe("the reorg poll on a replica that is not the leader", () => {
	const reorg: StreamsReorgRow = {
		id: "reorg-1",
		detected_at: "2026-01-01T00:00:00Z",
		fork_point_height: 700,
		orphaned_range: { from: "700:0", to: "701:0" },
		new_canonical_tip: "702:0",
	};
	const http = {
		listReorgs: async () => ({
			reorgs: [reorg],
			next_since: "2026-02-01T00:00:00Z",
		}),
	};

	it("leaves the poll position and the handled set alone so the leader can still apply it", async () => {
		const handled = new Set<string>();
		const seen: number[] = [];
		const gated = gateChainReorgOnLeader(
			async (height) => {
				seen.push(height);
			},
			() => false,
		);

		const next = await pollReorgsOnce(http, "since-0", gated, handled);

		expect(next).toBe("since-0");
		expect(handled.size).toBe(0);
		expect(seen).toEqual([]);
	});

	it("advances normally on the leader", async () => {
		const handled = new Set<string>();
		const seen: number[] = [];
		const gated = gateChainReorgOnLeader(
			async (height) => {
				seen.push(height);
			},
			() => true,
		);

		const next = await pollReorgsOnce(http, "since-0", gated, handled);

		expect(next).toBe("2026-02-01T00:00:00Z");
		expect(handled.has("reorg-1")).toBe(true);
		expect(seen).toEqual([700]);
	});
});
