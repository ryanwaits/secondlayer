import { afterAll, describe, expect, it } from "bun:test";
import { sql } from "@secondlayer/shared/db";
import { processBlock } from "./block-processor.ts";
import { ReorgFixture, mintBlock } from "./reorg-fixtures.ts";
import { handleSubgraphReorg } from "./reorg.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const FIRST = 7_300_000;
const fx = new ReorgFixture(FIRST, FIRST + 20);

afterAll(() => fx.cleanup());

/** What a reindex walk passes for each block it writes. */
async function walkAsReindex(
	def: Parameters<typeof processBlock>[0],
	from: number,
	to: number,
	journalFromHeight?: number,
) {
	for (let h = from; h <= to; h++) {
		await processBlock(def, def.name, h, {
			skipProgressUpdate: true,
			atomicProgress: { status: "reindexing" },
			journalFromHeight,
			preloaded: mintBlock(h),
		});
	}
}

async function finishReindex(name: string) {
	await fx.db
		.updateTable("subgraphs")
		.set({ status: sql`'active'` as never })
		.where("name", "=", name)
		.execute();
}

describe("a reindex walk journals the blocks a reorg can still reach", () => {
	it("a reorg of reindex-written blocks reverts their increments", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph("reindexing");
		await walkAsReindex(def, FIRST, FIRST + 5, FIRST);
		await finishReindex(def.name);

		await handleSubgraphReorg(FIRST + 3, async () => def);

		expect(await fx.balance(pgSchema)).toBe(3n);
	});

	it("journals nothing for blocks below the journal floor", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph("reindexing");
		await walkAsReindex(def, FIRST, FIRST + 5, FIRST + 100);

		const { rows } = await sql
			.raw(`SELECT count(*)::int AS n FROM "${pgSchema}"."_journal"`)
			.execute(fx.db);
		expect((rows as { n: number }[])[0]?.n).toBe(0);
	});
});
