import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { runClassicDecodeCycle } from "./classic-decoders.ts";
import {
	parseArgs,
	planReset,
	startCursorForHeight,
} from "./reset-checkpoints.ts";
import { DECODER_NAMES, writeDecoderCheckpoint } from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;
// Below reorg.test.ts's 990050 and clear of every other suite's seed height.
const H = 989601;

describe("startCursorForHeight", () => {
	test("height 0 clears the checkpoint so decoding starts at genesis", () => {
		expect(startCursorForHeight(0)).toBeNull();
	});

	test("height H resumes after the end of block H-1, before event (H, 0)", () => {
		expect(startCursorForHeight(100)).toBe("99:2147483647");
	});
});

describe("planReset", () => {
	const decoders = ["a", "b", "c", "d"];

	test("classifies each decoder by the direction of the checkpoint move", () => {
		const plan = planReset({
			startHeight: 100,
			decoders,
			current: {
				a: "200:5", // ahead of the reset: rewind
				b: "99:2147483647", // already there
				c: "50:3", // behind the reset: skips history
				d: null, // never ran: skips history
			},
		});
		expect(plan.map((row) => row.direction)).toEqual([
			"backward",
			"same",
			"forward",
			"forward",
		]);
		expect(plan.every((row) => row.next === "99:2147483647")).toBe(true);
	});

	test("a genesis reset never moves a checkpoint forward", () => {
		const plan = planReset({
			startHeight: 0,
			decoders: ["a", "b"],
			current: { a: "10:0", b: null },
		});
		expect(plan.map((row) => row.direction)).toEqual(["backward", "same"]);
	});
});

describe("parseArgs", () => {
	test("rejects an unknown flag", () => {
		expect(() => parseArgs(["--bogus"])).toThrow("unknown flag");
	});

	test("accepts --allow-forward and defaults it off", () => {
		expect(parseArgs(["--allow-forward"]).allowForward).toBe(true);
		expect(parseArgs([]).allowForward).toBe(false);
	});
});

describe.skipIf(!HAS_DB)("reset against the classic decoders", () => {
	const db = HAS_DB ? getDb() : null;

	async function cleanup() {
		if (!db) return;
		await db
			.deleteFrom("decoded_events")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("decoder_checkpoints")
			.where("decoder_name", "in", [...DECODER_NAMES])
			.execute();
	}

	beforeEach(cleanup);
	afterAll(cleanup);

	async function seedBlockWithTwoStxTransfers() {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: `0xreset${H}`,
				parent_hash: `0xreset${H - 1}`,
				burn_block_height: 100,
				timestamp: 1_800_000_000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values(
				["a", "b"].map((id, i) => ({
					tx_id: `tx-reset-${id}`,
					block_height: H,
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
				["a", "b"].map((id, i) => ({
					tx_id: `tx-reset-${id}`,
					block_height: H,
					event_index: i,
					type: "stx_transfer_event" as const,
					data: { sender: "SP1", recipient: "SP2", amount: "5" },
				})),
			)
			.execute();
	}

	async function resetAllTo(cursor: string | null) {
		if (!db) throw new Error("missing db");
		for (const decoderName of DECODER_NAMES) {
			await writeDecoderCheckpoint({ db, decoderName, cursor });
		}
	}

	async function decodedCursors() {
		if (!db) throw new Error("missing db");
		const rows = await db
			.selectFrom("decoded_events")
			.select("cursor")
			.where("block_height", "=", H)
			.where("event_type", "=", "stx_transfer")
			.orderBy("cursor")
			.execute();
		return rows.map((row) => row.cursor);
	}

	test("a reset to height H decodes the event at index 0 of block H", async () => {
		if (!db) throw new Error("missing db");
		await seedBlockWithTwoStxTransfers();

		await resetAllTo(startCursorForHeight(H));
		await runClassicDecodeCycle({ db, limit: 500 });
		expect(await decodedCursors()).toEqual([`${H}:0`, `${H}:1`]);

		// The old `${H}:0` cursor resumes strictly after (H, 0), so the first
		// event of the block was never decoded. This documents why the fix exists.
		await db
			.deleteFrom("decoded_events")
			.where("block_height", "=", H)
			.execute();
		await resetAllTo(`${H}:0`);
		await runClassicDecodeCycle({ db, limit: 500 });
		expect(await decodedCursors()).toEqual([`${H}:1`]);
	});
});
