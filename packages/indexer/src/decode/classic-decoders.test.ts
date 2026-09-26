import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	type ClassicDecodeWakeBus,
	type ClassicDecoderCommitFn,
	runClassicDecodeCycle,
	waitForNextClassicDecodeCycle,
} from "./classic-decoders.ts";
import { commitClassicDecoderBatch } from "./generic-commit.ts";
import { getDecodersHealth } from "./health.ts";
import {
	DECODER_NAMES,
	FT_TRANSFER_DECODER_NAME,
	NFT_TRANSFER_DECODER_NAME,
	PRINT_DECODER_NAME,
	STX_TRANSFER_DECODER_NAME,
	readDecoderCheckpoint,
	writeDecoderCheckpoint,
} from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("classic decoder in-process loop", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
		await sql`DELETE FROM decoder_checkpoints`.execute(db);
		await sql`DELETE FROM stage_failures`.execute(db);
		await sql`DELETE FROM stage_block_receipts`.execute(db);
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	async function seedBlock(opts: {
		height: number;
		parentHash: string;
		hash: string;
		events: {
			txId: string;
			type:
				| "ft_transfer_event"
				| "nft_transfer_event"
				| "stx_transfer_event"
				| "smart_contract_event";
			data: Record<string, unknown>;
		}[];
	}) {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: opts.height,
				hash: opts.hash,
				parent_hash: opts.parentHash,
				burn_block_height: 100 + opts.height,
				timestamp: 1_800_000_000 + opts.height,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values(
				opts.events.map((event, i) => ({
					tx_id: event.txId,
					block_height: opts.height,
					tx_index: i,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP1.contract",
					raw_tx: "0x00",
				})),
			)
			.execute();
		await db
			.insertInto("events")
			.values(
				opts.events.map((event) => ({
					tx_id: event.txId,
					block_height: opts.height,
					event_index: 0,
					type: event.type,
					data: event.data,
				})),
			)
			.execute();
	}

	function ftTransferEvent(txId: string, amount: string) {
		return {
			txId,
			type: "ft_transfer_event" as const,
			data: {
				asset_identifier: "SP1.token::token",
				sender: "SP1",
				recipient: "SP2",
				amount,
			},
		};
	}

	test("one cycle decodes every classic type off a single scan and reaches the sentinel", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [
				ftTransferEvent("tx-ft", "10"),
				{
					txId: "tx-nft",
					type: "nft_transfer_event",
					data: {
						asset_identifier: "SP1.collection::token",
						sender: "SP1",
						recipient: "SP2",
						value: "0x0100000000000000000000000000000001",
					},
				},
			],
		});

		const result = await runClassicDecodeCycle({ db, limit: 500 });

		expect(result.progressed).toBe(true);
		expect(result.decoded).toBe(2);
		expect(result.decodedByDecoder[FT_TRANSFER_DECODER_NAME]).toBe(1);
		expect(result.decodedByDecoder[NFT_TRANSFER_DECODER_NAME]).toBe(1);
		// Every classic decoder — including the 9 with no events in this block —
		// advances to the end-of-block sentinel off this one scan.
		for (const cursor of Object.values(result.checkpoints)) {
			expect(cursor).toBe("1:2147483647");
		}
		const rows = await db
			.selectFrom("decoded_events")
			.select(["event_type", "cursor"])
			.orderBy("cursor")
			.execute();
		expect(rows.map((row) => row.event_type)).toEqual([
			"ft_transfer",
			"nft_transfer",
		]);
	});

	test("a type with no events in range still advances to the sentinel", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [ftTransferEvent("tx-ft", "10")],
		});

		await runClassicDecodeCycle({ db, limit: 500 });

		const printCheckpoint = await readDecoderCheckpoint({
			db,
			decoderName: PRINT_DECODER_NAME,
		});
		expect(printCheckpoint).toBe("1:2147483647");
		const printRows = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.where("event_type", "=", "print")
			.execute();
		expect(printRows).toEqual([]);
	});

	test("decoders at different checkpoints converge without re-decoding", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [ftTransferEvent("tx-ft-1", "10")],
		});
		await seedBlock({
			height: 2,
			parentHash: "0x01",
			hash: "0x02",
			events: [ftTransferEvent("tx-ft-2", "20")],
		});

		// nft_transfer already caught up through block 1; ft_transfer has never
		// committed. The shared scan starts at the lowest (ft_transfer, genesis)
		// and must not re-decode anything nft_transfer already owns (there is
		// none here, but its checkpoint must not regress either).
		await writeDecoderCheckpoint({
			db,
			decoderName: NFT_TRANSFER_DECODER_NAME,
			cursor: "1:2147483647",
		});

		const result = await runClassicDecodeCycle({ db, limit: 500 });

		expect(result.decodedByDecoder[FT_TRANSFER_DECODER_NAME]).toBe(2);
		expect(result.checkpoints[FT_TRANSFER_DECODER_NAME]).toBe("2:2147483647");
		expect(result.checkpoints[NFT_TRANSFER_DECODER_NAME]).toBe("2:2147483647");
		const ftRows = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.where("event_type", "=", "ft_transfer")
			.orderBy("cursor")
			.execute();
		expect(ftRows.map((row) => row.cursor)).toEqual(["1:0", "2:0"]);
	});

	test("a poison event is skipped; other classic types in the same batch still land", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [
				// Missing sender/recipient/amount → decodeFtTransfer throws.
				{ txId: "tx-bad", type: "ft_transfer_event", data: {} },
				ftTransferEvent("tx-good", "5"),
			],
		});

		const result = await runClassicDecodeCycle({ db, limit: 500 });

		expect(result.decodedByDecoder[FT_TRANSFER_DECODER_NAME]).toBe(1);
		const rows = await db
			.selectFrom("decoded_events")
			.select("tx_id")
			.execute();
		expect(rows).toEqual([{ tx_id: "tx-good" }]);
		const failures = await db
			.selectFrom("stage_failures")
			.select(["stage_id", "class"])
			.where("stage_id", "=", FT_TRANSFER_DECODER_NAME)
			.execute();
		expect(failures).toEqual([
			{ stage_id: FT_TRANSFER_DECODER_NAME, class: "omission" },
		]);
	});

	test("a block wider than the page limit is paged within one cycle and still reaches the sentinel", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [
				ftTransferEvent("tx-1", "1"),
				ftTransferEvent("tx-2", "2"),
				ftTransferEvent("tx-3", "3"),
				ftTransferEvent("tx-4", "4"),
				ftTransferEvent("tx-5", "5"),
			],
		});

		// A page limit of 2 forces 3 reader calls for 5 events, all within one
		// cycle, each with its own commit (2.4 revision: per-page commits, not
		// one accumulated commit) — the cycle must still land on the sentinel
		// once the last (short) page proves the block is fully scanned.
		const result = await runClassicDecodeCycle({
			db,
			limit: 2,
			maxPagesPerCycle: 10,
		});

		expect(result.scanned).toBe(5);
		expect(result.pagesCommitted).toBe(3);
		expect(result.decodedByDecoder[FT_TRANSFER_DECODER_NAME]).toBe(5);
		expect(result.checkpoints[FT_TRANSFER_DECODER_NAME]).toBe("1:2147483647");
		const rows = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.orderBy("cursor")
			.execute();
		expect(rows.map((r) => r.cursor)).toEqual([
			"1:0",
			"1:1",
			"1:2",
			"1:3",
			"1:4",
		]);
	});

	test("an idle instance with nothing past the source tip does not scan or commit", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [ftTransferEvent("tx-ft", "10")],
		});
		await runClassicDecodeCycle({ db, limit: 500 });

		const result = await runClassicDecodeCycle({ db, limit: 500 });
		expect(result.progressed).toBe(false);
		expect(result.scanned).toBe(0);
	});

	test("a rewound checkpoint aborts the WHOLE batch, not just the moved decoder", async () => {
		if (!db) throw new Error("missing db");
		// Every decoder actually sits at "5:2147483647" in the DB (as if a
		// concurrent reorg just rewound it), but the batch believes ft_transfer
		// started from an earlier cursor — the exact race `assertCheckpointUnmoved`
		// exists to catch between a cycle's read and its commit.
		for (const decoderName of [
			FT_TRANSFER_DECODER_NAME,
			STX_TRANSFER_DECODER_NAME,
		]) {
			await writeDecoderCheckpoint({ db, decoderName, cursor: "5:2147483647" });
		}

		await expect(
			commitClassicDecoderBatch(
				[
					{
						decoderName: FT_TRANSFER_DECODER_NAME,
						checkpointCursor: "10:0",
						rows: [
							{
								cursor: "10:0",
								block_height: 10,
								tx_id: "tx-ft",
								tx_index: 0,
								event_index: 0,
								event_type: "ft_transfer",
								decoded_payload: {
									contract_id: "SP1.token",
									asset_identifier: "SP1.token::token",
									token_name: "token",
									sender: "SP1",
									recipient: "SP2",
									amount: "1",
								},
								source_cursor: "10:0",
							},
						],
						receipts: [],
						// Stale: the batch thinks it started from "3:0", but the row
						// actually holds "5:2147483647".
						startedFrom: "3:0",
					},
					{
						decoderName: STX_TRANSFER_DECODER_NAME,
						checkpointCursor: "10:0",
						rows: [
							{
								cursor: "10:1",
								block_height: 10,
								tx_id: "tx-stx",
								tx_index: 1,
								event_index: 0,
								event_type: "stx_transfer",
								decoded_payload: {
									sender: "SP1",
									recipient: "SP2",
									amount: "1",
									memo: null,
								},
								source_cursor: "10:1",
							},
						],
						receipts: [],
						// This one's expectation IS correct — it must still abort,
						// because the batch commits atomically.
						startedFrom: "5:2147483647",
					},
				],
				{ db },
			),
		).rejects.toThrow(/rewound/);

		const stxCheckpoint = await readDecoderCheckpoint({
			db,
			decoderName: STX_TRANSFER_DECODER_NAME,
		});
		expect(stxCheckpoint).toBe("5:2147483647");
		const rows = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.execute();
		expect(rows).toEqual([]);
	});

	test("a backlog spanning many pages commits each page on its own and never holds more than one page of rows", async () => {
		if (!db) throw new Error("missing db");
		// 30 ft_transfer events in one block, well past a small page limit —
		// simulates the gap after decoder downtime (deploy/crash/reset), which
		// can be hours or days of backlog. Every commit must be bounded by the
		// page limit, not by how big the whole backlog is.
		const limit = 3;
		const events = Array.from({ length: 30 }, (_, i) =>
			ftTransferEvent(`tx-${i}`, String(i + 1)),
		);
		await seedBlock({ height: 1, parentHash: "0x00", hash: "0x01", events });

		const commitCalls: number[] = [];
		const spyCommit: ClassicDecoderCommitFn = async (entries, commitOpts) => {
			const rowCount = entries.reduce((n, e) => n + e.rows.length, 0);
			commitCalls.push(rowCount);
			await commitClassicDecoderBatch(entries, commitOpts);
		};

		const result = await runClassicDecodeCycle({
			db,
			limit,
			maxPagesPerCycle: 20,
			commit: spyCommit,
		});

		// 30 events / limit 3 = 10 full pages, plus one short (empty) page that
		// proves the range is exhausted and commits the sentinel.
		expect(commitCalls.length).toBeGreaterThanOrEqual(10);
		for (const rowCount of commitCalls) {
			expect(rowCount).toBeLessThanOrEqual(limit);
		}
		expect(result.decodedByDecoder[FT_TRANSFER_DECODER_NAME]).toBe(30);
		expect(result.checkpoints[FT_TRANSFER_DECODER_NAME]).toBe("1:2147483647");
		const rowTotal = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.execute();
		expect(rowTotal).toHaveLength(30);
	});

	test("a rewind between two page commits aborts only the in-flight page; the next cycle resumes from the rewound checkpoints", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [ftTransferEvent("tx-1", "1")],
		});
		await seedBlock({
			height: 2,
			parentHash: "0x01",
			hash: "0x02",
			events: [ftTransferEvent("tx-2", "2")],
		});

		let calls = 0;
		const sabotagingCommit: ClassicDecoderCommitFn = async (
			entries,
			commitOpts,
		) => {
			calls++;
			if (calls === 2) {
				// Simulate a concurrent reorg rewinding ft_transfer's checkpoint
				// AFTER page 1 committed but BEFORE page 2's commit runs — exactly
				// the race `assertCheckpointUnmoved` exists to catch.
				await writeDecoderCheckpoint({
					db,
					decoderName: FT_TRANSFER_DECODER_NAME,
					cursor: null,
				});
			}
			await commitClassicDecoderBatch(entries, commitOpts);
		};

		await expect(
			runClassicDecodeCycle({
				db,
				limit: 1,
				maxPagesPerCycle: 10,
				commit: sabotagingCommit,
			}),
		).rejects.toThrow(/rewound/);

		// Page 1 (block 1's event) is durably committed; page 2 (block 2's
		// event) rolled back with the sabotaged commit.
		const rowsAfterAbort = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.execute();
		expect(rowsAfterAbort.map((r) => r.cursor)).toEqual(["1:0"]);
		const rewoundCheckpoint = await readDecoderCheckpoint({
			db,
			decoderName: FT_TRANSFER_DECODER_NAME,
		});
		expect(rewoundCheckpoint).toBeNull();

		// The next cycle re-reads checkpoints from scratch, sees the rewind, and
		// resumes cleanly — no duplicate rows, no stuck loop.
		const resumed = await runClassicDecodeCycle({ db, limit: 1 });
		expect(resumed.progressed).toBe(true);
		expect(resumed.checkpoints[FT_TRANSFER_DECODER_NAME]).toBe("2:2147483647");
		const rowsAfterResume = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.orderBy("cursor")
			.execute();
		expect(rowsAfterResume.map((r) => r.cursor)).toEqual(["1:0", "2:0"]);
	});

	test("health reports all 11 classic decoders correctly after an in-process cycle", async () => {
		if (!db) throw new Error("missing db");
		await seedBlock({
			height: 1,
			parentHash: "0x00",
			hash: "0x01",
			events: [ftTransferEvent("tx-ft", "10")],
		});

		await runClassicDecodeCycle({ db, limit: 500 });

		const health = await getDecodersHealth({ db, decoderNames: DECODER_NAMES });
		expect(health.decoders).toHaveLength(11);
		expect(health.status).toBe("healthy");
		for (const decoder of health.decoders) {
			expect(decoder.checkpoint).toBe("1:2147483647");
			expect(decoder.checkpoint_committed_height).toBe(1);
			expect(decoder.tip_block_height).toBe(1);
			expect(decoder.lag_seconds).toBe(0);
			expect(decoder.status).toBe("healthy");
		}
	});
});

describe("waitForNextClassicDecodeCycle", () => {
	function sleepFn(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	test("no wake bus — waits out the empty-poll backoff and reports timer", async () => {
		const start = Date.now();
		const trigger = await waitForNextClassicDecodeCycle({
			wakeBus: null,
			generationAtCycleStart: 0,
			emptyBackoffMs: 150,
			sleep: sleepFn,
		});
		expect(trigger).toBe("timer");
		expect(Date.now() - start).toBeGreaterThanOrEqual(140);
	});

	test("generation unchanged since the cycle started — a wake still resolves it ahead of the backoff timer", async () => {
		let resolveWait: () => void = () => {};
		const wakeBus: ClassicDecodeWakeBus = {
			wait: () =>
				new Promise((resolve) => {
					resolveWait = resolve;
				}),
			generation: () => 5,
		};
		const pending = waitForNextClassicDecodeCycle({
			wakeBus,
			generationAtCycleStart: 5,
			emptyBackoffMs: 5000,
			sleep: sleepFn,
		});
		await sleepFn(20);
		resolveWait();
		expect(await pending).toBe("wake");
	});

	test("a NOTIFY dropped while the previous cycle was busy (generation already advanced) reruns immediately instead of waiting out the backoff", async () => {
		// `wait()` deliberately never resolves — proof this returns "wake"
		// purely from the generation mismatch, not from a real wake landing
		// during the call.
		const wakeBus: ClassicDecodeWakeBus = {
			wait: () => new Promise(() => {}),
			generation: () => 6,
		};
		const start = Date.now();
		const trigger = await waitForNextClassicDecodeCycle({
			wakeBus,
			generationAtCycleStart: 5,
			emptyBackoffMs: 5000,
			sleep: sleepFn,
		});
		expect(trigger).toBe("wake");
		// Without the generation check this would hang out the full 5s backoff.
		expect(Date.now() - start).toBeLessThan(200);
	});
});
