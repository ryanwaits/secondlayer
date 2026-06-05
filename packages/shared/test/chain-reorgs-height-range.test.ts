import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "../src/db/index.ts";
import {
	insertChainReorg,
	readChainReorgsForHeightRange,
} from "../src/db/queries/chain-reorgs.ts";

const HAS_DB = !!process.env.DATABASE_URL;
// High, isolated heights so the test never collides with seeded chain data.
const FORK = 8_900_100;
const TO = 8_900_105;

describe.skipIf(!HAS_DB)("readChainReorgsForHeightRange", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM chain_reorgs WHERE fork_point_height = ${FORK}`.execute(
			db,
		);
		await insertChainReorg({
			db,
			forkPointHeight: FORK,
			oldIndexBlockHash: "0xold",
			newIndexBlockHash: "0xnew",
			orphanedFrom: { block_height: FORK, event_index: 0 },
			orphanedTo: { block_height: TO, event_index: 9 },
			newCanonicalTip: { block_height: FORK, event_index: 0 },
		});
	});

	async function heightsOf(from: number, to: number): Promise<number[]> {
		if (!db) throw new Error("missing db");
		const rows = await readChainReorgsForHeightRange({
			fromHeight: from,
			toHeight: to,
			db,
		});
		return rows
			.filter((r) => r.fork_point_height === FORK)
			.map((r) => r.fork_point_height);
	}

	test("includes a reorg whose orphaned height span overlaps the window", async () => {
		expect(await heightsOf(FORK, TO)).toEqual([FORK]);
		// Partial overlap at the high end (orphaned_to_height TO >= 8_900_104).
		expect(await heightsOf(TO - 1, TO + 50)).toEqual([FORK]);
		// Touches the low boundary.
		expect(await heightsOf(1, FORK)).toEqual([FORK]);
	});

	test("excludes a reorg fully outside the window", async () => {
		expect(await heightsOf(1, FORK - 1)).toEqual([]);
		expect(await heightsOf(TO + 1, TO + 100)).toEqual([]);
	});
});
