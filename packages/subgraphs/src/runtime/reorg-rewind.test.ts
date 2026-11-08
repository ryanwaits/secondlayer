import { afterAll, describe, expect, it } from "bun:test";
import { sql } from "@secondlayer/shared/db";
import { rewindMissedReorgs } from "./reorg-detect.ts";
import { ReorgFixture, newHash } from "./reorg-fixtures.ts";
import { handleSubgraphReorg } from "./reorg.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const FIRST = 7_200_000;
const fx = new ReorgFixture(FIRST, FIRST + 20);

afterAll(() => fx.cleanup());

describe("a reorg rewinds the cursor with the revert", () => {
	it("moves the cursor to just before the fork even when the fork block is not canonical yet", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph();
		await fx.walk(def, FIRST, FIRST + 5);
		// The indexer commits the reorg before it stores the replacement block.
		await fx.orphan(FIRST + 3);

		await handleSubgraphReorg(FIRST + 3, async () => def);

		expect(await fx.balance(pgSchema)).toBe(3n);
		expect(Number((await fx.row(def.name)).last_processed_block)).toBe(
			FIRST + 2,
		);
	});

	it("leaves a cursor below the fork alone", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph();
		await fx.walk(def, FIRST, FIRST + 2);

		await handleSubgraphReorg(FIRST + 10, async () => def);

		expect(await fx.balance(pgSchema)).toBe(3n);
		expect(Number((await fx.row(def.name)).last_processed_block)).toBe(
			FIRST + 2,
		);
	});
});

describe("a halted subgraph is reorged like a running one", () => {
	async function halt(name: string) {
		await fx.db
			.updateTable("subgraphs")
			.set({ status: sql`'error'` as never })
			.where("name", "=", name)
			.execute();
	}

	it("reverts rows and rewinds the cursor and stays halted", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph();
		await fx.walk(def, FIRST, FIRST + 5);
		await halt(def.name);
		await fx.orphan(FIRST + 3);

		await handleSubgraphReorg(FIRST + 3, async () => def);

		expect(await fx.balance(pgSchema)).toBe(3n);
		const after = await fx.row(def.name);
		expect(Number(after.last_processed_block)).toBe(FIRST + 2);
		expect(after.status).toBe("error");
	});

	it("finds a reorg it missed while halted", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph();
		await fx.walk(def, FIRST, FIRST + 4);
		await halt(def.name);
		await fx.db
			.updateTable("blocks")
			.set({ hash: newHash(FIRST + 4) })
			.where("height", "=", FIRST + 4)
			.execute();

		await rewindMissedReorgs([await fx.row(def.name)], async () => def);

		expect(await fx.balance(pgSchema)).toBe(4n);
		const after = await fx.row(def.name);
		expect(Number(after.last_processed_block)).toBe(FIRST + 3);
		expect(after.status).toBe("error");
	});
});
