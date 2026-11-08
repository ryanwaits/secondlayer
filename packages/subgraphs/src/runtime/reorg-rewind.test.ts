import { afterAll, describe, expect, it } from "bun:test";
import { ReorgFixture } from "./reorg-fixtures.ts";
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
