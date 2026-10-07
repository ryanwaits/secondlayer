import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import {
	JournalApplier,
	LIVE_BACKLOG_MAX,
	LIVE_BURN_TIP_DISTANCE,
	type ReceiveOutcome,
	chooseIngestMode,
	highestReceivedSequence,
	receiveNewBlock,
} from "./catch-up.ts";
import { type IngestResult, ingestNewBlock } from "./ingest.ts";
import { appendObserverReceipt, bodyFromText } from "./observer-journal.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const NETWORK = "catch-up-test";
const BURN = 900_000;
const FAR_TIP = BURN + 1_000;
const H = 990_301;

describe("chooseIngestMode", () => {
	const base = {
		forcedLive: false,
		backlog: 0,
		blockBurnHeight: BURN,
		nodeBurnTip: BURN,
	};

	test("a block at the node's burn tip with no backlog is live", () => {
		expect(chooseIngestMode(base)).toBe("live");
	});

	test("a block far behind the node's burn tip catches up", () => {
		expect(
			chooseIngestMode({
				...base,
				nodeBurnTip: BURN + LIVE_BURN_TIP_DISTANCE + 1,
			}),
		).toBe("catch-up");
		expect(
			chooseIngestMode({ ...base, nodeBurnTip: BURN + LIVE_BURN_TIP_DISTANCE }),
		).toBe("live");
	});

	test("a backlog keeps catch-up on until it drains, even at the tip", () => {
		expect(chooseIngestMode({ ...base, backlog: LIVE_BACKLOG_MAX })).toBe(
			"catch-up",
		);
		expect(chooseIngestMode({ ...base, backlog: LIVE_BACKLOG_MAX - 1 })).toBe(
			"live",
		);
	});

	test("an unknown node tip keeps synchronous ingest", () => {
		expect(chooseIngestMode({ ...base, nodeBurnTip: null })).toBe("live");
	});

	test("INGEST_MODE=live forces live", () => {
		expect(
			chooseIngestMode({
				...base,
				forcedLive: true,
				backlog: 5_000,
				nodeBurnTip: FAR_TIP,
			}),
		).toBe("live");
	});
});

function block(height: number, burn = BURN): NewBlockPayload {
	return {
		block_hash: `0xcatchup${height}`,
		block_height: height,
		index_block_hash: `0xcatchup${height}`,
		parent_block_hash: `0xcatchup${height - 1}`,
		parent_index_block_hash: `0xcatchup${height - 1}`,
		burn_block_hash: "0xburn",
		burn_block_height: burn,
		miner_txid: "0x00",
		timestamp: 1_700_000_000 + height,
		transactions: [],
		events: [],
	};
}

/** Ingest stub that parks every block until the test lets it through. */
function gatedIngest() {
	const started: number[] = [];
	const applied: number[] = [];
	const gates: Array<() => void> = [];
	let open = false;
	return {
		started,
		applied,
		ingest: async (payload: NewBlockPayload): Promise<IngestResult> => {
			started.push(payload.block_height);
			if (!open) await new Promise<void>((resolve) => gates.push(resolve));
			applied.push(payload.block_height);
			return {
				status: "ok",
				block_height: payload.block_height,
				transactions: 0,
				events: 0,
			};
		},
		releaseOne: () => gates.shift()?.(),
		openAll: () => {
			open = true;
			for (const gate of gates.splice(0)) gate();
		},
	};
}

async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("condition not met in time");
		await Bun.sleep(5);
	}
}

function settledFlag<T>(promise: Promise<T>): { done: boolean } {
	const flag = { done: false };
	promise.then(
		() => {
			flag.done = true;
		},
		() => {
			flag.done = true;
		},
	);
	return flag;
}

async function journalStatus(sequence: string) {
	return getSourceDb()
		.selectFrom("observer_journal")
		.select(["status", "result"])
		.where("sequence", "=", sequence)
		.executeTakeFirstOrThrow();
}

describe.skipIf(!HAS_DB)("catch-up ingest", () => {
	let applier: JournalApplier | null = null;
	let tip: number | null = FAR_TIP;

	async function clean() {
		await getSourceDb()
			.deleteFrom("observer_journal")
			.where("network", "=", NETWORK)
			.execute();
	}

	beforeEach(async () => {
		tip = FAR_TIP;
		await clean();
	});
	afterEach(async () => {
		await applier?.stop();
		applier = null;
		await clean();
	});

	function receive(
		height: number,
		burn = BURN,
		forcedLive = false,
	): Promise<ReceiveOutcome> {
		if (!applier) throw new Error("no applier");
		return receiveNewBlock(
			{ network: NETWORK, applier, forcedLive, nodeBurnTip: () => tip },
			{
				body: bodyFromText(JSON.stringify(block(height, burn))),
				source: "stacks-node",
			},
		);
	}

	test("catch-up replies once the block is journaled, before it is applied", async () => {
		const stub = gatedIngest();
		applier = new JournalApplier({ network: NETWORK, ingest: stub.ingest });
		applier.start();

		const outcome = await receive(100);
		expect(outcome.mode).toBe("catch-up");
		expect(stub.applied).toEqual([]);
		expect((await journalStatus(outcome.sequence)).status).toBe("received");

		stub.openAll();
		await applier.whenIdle();
		expect(stub.applied).toEqual([100]);
		expect((await journalStatus(outcome.sequence)).status).toBe("processed");
	});

	test("the applier applies blocks strictly in journal order", async () => {
		const applied: number[] = [];
		let inFlight = 0;
		let maxInFlight = 0;
		applier = new JournalApplier({
			network: NETWORK,
			ingest: async (payload) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Bun.sleep(Math.floor(Math.random() * 3));
				applied.push(payload.block_height);
				inFlight--;
				return {
					status: "ok",
					block_height: payload.block_height,
					transactions: 0,
					events: 0,
				};
			},
		});
		applier.start();

		// Concurrent deliveries: journal order is whatever order the appends
		// committed in, and the applier must follow it exactly.
		const heights = Array.from({ length: 60 }, (_, i) => 200 + i);
		const outcomes = await Promise.all(heights.map((h) => receive(h)));
		await applier.whenIdle();

		const journalOrder = outcomes
			.map((o) => ({
				seq: BigInt(o.sequence),
				height: o.mode === "catch-up" ? o.block_height : -1,
			}))
			.sort((a, b) => (a.seq < b.seq ? -1 : 1))
			.map((o) => o.height);
		expect(applied).toEqual(journalOrder);
		expect(maxInFlight).toBe(1);
	});

	test("backpressure holds the reply once the backlog passes the limit", async () => {
		const stub = gatedIngest();
		applier = new JournalApplier({
			network: NETWORK,
			ingest: stub.ingest,
			backlogLimit: 3,
		});
		applier.start();

		await receive(300);
		await until(() => stub.started.includes(300));
		await receive(301);
		await receive(302);
		const fourth = receive(303);
		const fourthDone = settledFlag(fourth);
		await Bun.sleep(100);
		expect(fourthDone.done).toBe(false);

		stub.releaseOne();
		const outcome = await fourth;
		expect(outcome.mode).toBe("catch-up");
		expect(stub.applied).toEqual([300]);

		stub.openAll();
		await applier.whenIdle();
		expect(stub.applied).toEqual([300, 301, 302, 303]);
	});

	test("near the tip the reply waits for the apply (live)", async () => {
		const stub = gatedIngest();
		applier = new JournalApplier({ network: NETWORK, ingest: stub.ingest });
		applier.start();
		tip = BURN;

		const reply = receive(400);
		const replied = settledFlag(reply);
		await until(() => stub.started.includes(400));
		await Bun.sleep(50);
		expect(replied.done).toBe(false);

		stub.openAll();
		const outcome = await reply;
		expect(outcome.mode).toBe("live");
		if (outcome.mode !== "live") throw new Error("expected live");
		expect(outcome.result.block_height).toBe(400);
		expect((await journalStatus(outcome.sequence)).status).toBe("processed");
	});

	test("switches back to live on its own once the backlog drains near the tip", async () => {
		const stub = gatedIngest();
		applier = new JournalApplier({ network: NETWORK, ingest: stub.ingest });
		applier.start();

		const modes: string[] = [];
		for (let h = 500; h < 500 + LIVE_BACKLOG_MAX + 2; h++) {
			modes.push((await receive(h)).mode);
		}
		// The node reached its tip, but the backlog is still draining.
		tip = BURN;
		modes.push((await receive(600)).mode);
		expect(new Set(modes)).toEqual(new Set(["catch-up"]));

		stub.openAll();
		await applier.whenIdle();
		const live = await receive(601);
		expect(live.mode).toBe("live");
		expect(stub.applied.at(-1)).toBe(601);
	});

	test("a failed live apply is marked failed and fails the reply, as synchronous ingest did", async () => {
		applier = new JournalApplier({
			network: NETWORK,
			ingest: async () => {
				throw new Error("boom");
			},
		});
		applier.start();
		tip = BURN;

		const reply = receive(700);
		await expect(reply).rejects.toThrow("boom");
		const row = await getSourceDb()
			.selectFrom("observer_journal")
			.select(["status", "error"])
			.where("network", "=", NETWORK)
			.executeTakeFirstOrThrow();
		expect(row).toEqual({ status: "failed", error: "boom" });
	});

	test("a failed catch-up apply is retried, never skipped", async () => {
		let attempts = 0;
		const applied: number[] = [];
		applier = new JournalApplier({
			network: NETWORK,
			ingest: async (payload) => {
				if (payload.block_height === 800 && attempts++ < 2) {
					throw new Error("transient");
				}
				applied.push(payload.block_height);
				return {
					status: "ok",
					block_height: payload.block_height,
					transactions: 0,
					events: 0,
				};
			},
		});
		applier.start();

		await receive(800);
		await receive(801);
		await until(() => applied.length === 2, 10_000);
		expect(applied).toEqual([800, 801]);
		expect(attempts).toBe(3);
		expect(applier.state().lastError).toBeNull();
	});

	test("rows at or below the start floor (a refused spool) are left alone", async () => {
		const db = getSourceDb();
		for (const h of [900, 901]) {
			await appendObserverReceipt(db, {
				network: NETWORK,
				path: "/new_block",
				source: "stacks-node",
				body: bodyFromText(JSON.stringify(block(h))),
			});
		}
		const floor = await highestReceivedSequence(db, NETWORK);
		const stub = gatedIngest();
		stub.openAll();
		applier = new JournalApplier({ network: NETWORK, ingest: stub.ingest });
		applier.start(floor);

		await receive(902);
		await applier.whenIdle();
		expect(stub.applied).toEqual([902]);
		const leftover = await db
			.selectFrom("observer_journal")
			.select("status")
			.where("network", "=", NETWORK)
			.where("status", "=", "received")
			.execute();
		expect(leftover).toHaveLength(2);
	});
});

describe.skipIf(!HAS_DB)("catch-up crash resume", () => {
	const PROGRESS_NETWORK = "catch-up-crash-test";

	async function clean() {
		const db = getSourceDb();
		await db
			.deleteFrom("observer_journal")
			.where("network", "=", NETWORK)
			.execute();
		await db.deleteFrom("vm_events").where("block_height", "=", H).execute();
		await db
			.deleteFrom("vm_events_archive")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db
			.deleteFrom("events_archive")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db
			.deleteFrom("transactions_archive")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", PROGRESS_NETWORK)
			.execute();
	}

	beforeEach(clean);
	afterEach(clean);

	async function fixture(): Promise<NewBlockPayload> {
		const url = new URL(
			"../test/fixtures/observer/new_block.vm_events.all_types.json",
			import.meta.url,
		);
		const payload = (await Bun.file(url).json()) as NewBlockPayload;
		return { ...payload, block_height: H, block_hash: "0xcrash-resume" };
	}

	async function counts() {
		const db = getSourceDb();
		const one = async (table: "transactions" | "events" | "vm_events") =>
			Number(
				(
					await db
						.selectFrom(table)
						.select(db.fn.countAll().as("n"))
						.where("block_height", "=", H)
						.executeTakeFirstOrThrow()
				).n,
			);
		const blocks = await db
			.selectFrom("blocks")
			.select(db.fn.countAll().as("n"))
			.where("height", "=", H)
			.executeTakeFirstOrThrow();
		return {
			blocks: Number(blocks.n),
			transactions: await one("transactions"),
			events: await one("events"),
			vm_events: await one("vm_events"),
		};
	}

	async function resume(): Promise<void> {
		const applier = new JournalApplier({
			network: NETWORK,
			ingest: (payload) =>
				ingestNewBlock(payload, { network: PROGRESS_NETWORK }),
		});
		applier.start();
		await applier.whenIdle();
		await applier.stop();
	}

	test("a crash after the apply committed but before the row was marked re-applies as a duplicate", async () => {
		const db = getSourceDb();
		const payload = await fixture();
		const receipt = await appendObserverReceipt(db, {
			network: NETWORK,
			path: "/new_block",
			source: "stacks-node",
			body: bodyFromText(JSON.stringify(payload)),
		});
		// The applier got this far, then the process died.
		await ingestNewBlock(payload, { network: PROGRESS_NETWORK });
		const before = await counts();
		expect(before).toEqual({
			blocks: 1,
			transactions: 1,
			events: 1,
			vm_events: 5,
		});

		await resume();

		expect(await counts()).toEqual(before);
		const row = await journalStatus(receipt.sequence);
		expect(row.status).toBe("processed");
		expect((row.result as IngestResult).status).toBe("duplicate");
	});

	test("a crash before the apply committed applies the journaled block on restart", async () => {
		const db = getSourceDb();
		const receipt = await appendObserverReceipt(db, {
			network: NETWORK,
			path: "/new_block",
			source: "stacks-node",
			body: bodyFromText(JSON.stringify(await fixture())),
		});

		await resume();

		expect(await counts()).toEqual({
			blocks: 1,
			transactions: 1,
			events: 1,
			vm_events: 5,
		});
		const row = await journalStatus(receipt.sequence);
		expect(row.status).toBe("processed");
		expect((row.result as IngestResult).status).toBe("ok");
	});
});
