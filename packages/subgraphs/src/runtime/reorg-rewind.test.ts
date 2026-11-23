import { afterAll, describe, expect, it } from "bun:test";
import { sql } from "@secondlayer/shared/db";
import { emitFactoryDDL } from "../schema/generator.ts";
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

describe("a reorg clears factory addresses and violations with the revert", () => {
	async function seedSideState(pgSchema: string, subgraphId: string) {
		for (const stmt of emitFactoryDDL(pgSchema))
			await sql.raw(stmt).execute(fx.db);
		await sql
			.raw(
				`INSERT INTO "${pgSchema}"."_factory_addresses" (source_name, address, block_height)
				 VALUES ('registry', 'kept', ${FIRST + 2}), ('registry', 'orphaned', ${FIRST + 3})`,
			)
			.execute(fx.db);
		await fx.db
			.insertInto("subgraph_violations")
			.values(
				[FIRST + 2, FIRST + 4].map((height) => ({
					subgraph_id: subgraphId,
					subgraph_name: "test",
					source_name: "prints",
					block_height: height,
					tx_id: "0xtx",
					reason: "mismatch",
					sample_payload: {},
				})),
			)
			.execute();
	}

	async function factoryAddresses(pgSchema: string): Promise<string[]> {
		const { rows } = await sql
			.raw(
				`SELECT address FROM "${pgSchema}"."_factory_addresses" ORDER BY address`,
			)
			.execute(fx.db);
		return (rows as { address: string }[]).map((r) => r.address);
	}

	async function violationHeights(subgraphId: string): Promise<number[]> {
		const rows = await fx.db
			.selectFrom("subgraph_violations")
			.select("block_height")
			.where("subgraph_id", "=", subgraphId)
			.orderBy("block_height")
			.execute();
		return rows.map((r) => Number(r.block_height));
	}

	it("deletes rows at or above the fork and keeps rows below it", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph();
		await fx.walk(def, FIRST, FIRST + 5);
		const { id } = await fx.row(def.name);
		await seedSideState(pgSchema, id);
		await fx.orphan(FIRST + 3);

		await handleSubgraphReorg(FIRST + 3, async () => def);

		expect(await factoryAddresses(pgSchema)).toEqual(["kept"]);
		expect(await violationHeights(id)).toEqual([FIRST + 2]);
		expect(Number((await fx.row(def.name)).last_processed_block)).toBe(
			FIRST + 2,
		);
	});

	it("rolls back the cursor rewind when a cleanup delete fails, so a retry still cleans up", async () => {
		await fx.seedCanonical();
		const { def, pgSchema } = await fx.newSubgraph();
		await fx.walk(def, FIRST, FIRST + 5);
		const { id } = await fx.row(def.name);
		await seedSideState(pgSchema, id);
		await fx.orphan(FIRST + 3);

		const fn = `${pgSchema}.block_violation_delete`;
		await sql
			.raw(
				`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
				 BEGIN RAISE EXCEPTION 'violation delete blocked'; END $$`,
			)
			.execute(fx.db);
		const trigger = `block_violation_delete_${pgSchema}`;
		await sql
			.raw(
				`CREATE TRIGGER ${trigger} BEFORE DELETE ON subgraph_violations
				 FOR EACH ROW WHEN (OLD.subgraph_id = '${id}') EXECUTE FUNCTION ${fn}()`,
			)
			.execute(fx.db);
		try {
			await handleSubgraphReorg(FIRST + 3, async () => def);
		} finally {
			await sql
				.raw(`DROP TRIGGER IF EXISTS ${trigger} ON subgraph_violations`)
				.execute(fx.db);
		}

		expect(Number((await fx.row(def.name)).last_processed_block)).toBe(
			FIRST + 5,
		);
		expect(await factoryAddresses(pgSchema)).toEqual(["kept", "orphaned"]);
		expect(await violationHeights(id)).toEqual([FIRST + 2, FIRST + 4]);
		expect(await fx.balance(pgSchema)).toBe(6n);

		await handleSubgraphReorg(FIRST + 3, async () => def);

		expect(await factoryAddresses(pgSchema)).toEqual(["kept"]);
		expect(await violationHeights(id)).toEqual([FIRST + 2]);
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
