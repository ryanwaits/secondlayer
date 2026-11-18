import { afterAll, describe, expect, it } from "bun:test";
import { sql } from "@secondlayer/shared/db";
import { emitFactoryDDL } from "../schema/generator.ts";
import type { SubgraphDefinition, SubgraphHandler } from "../types.ts";
import { loadBatchMembership } from "./batch-membership.ts";
import { processBlock, resolveFactoryContracts } from "./block-processor.ts";
import { ADDRESS, ASSET, ReorgFixture, mintBlock } from "./reorg-fixtures.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const FIRST = 7_400_000;
const fx = new ReorgFixture(FIRST, FIRST + 20);

afterAll(() => fx.cleanup());

/** `registry` mints reveal their recipient as a factory address. */
function factoryDef(base: SubgraphDefinition): SubgraphDefinition {
	return {
		...base,
		sources: {
			registry: { type: "ft_mint", assetIdentifier: ASSET },
			children: {
				type: "ft_transfer",
				factory: { from: "registry", field: "recipient" },
			},
		} as unknown as SubgraphDefinition["sources"],
		handlers: {
			registry: base.handlers.mint as SubgraphHandler,
			children: (async () => {}) as unknown as SubgraphHandler,
		},
	};
}

async function factoryAddresses(pgSchema: string): Promise<string[]> {
	const { rows } = await sql
		.raw(`SELECT address FROM "${pgSchema}"."_factory_addresses"`)
		.execute(fx.db);
	return (rows as { address: string }[]).map((r) => r.address);
}

describe("factory discovery commits with its block", () => {
	it("stores the revealed address in the block's own transaction", async () => {
		await fx.seedCanonical();
		const { def: base, pgSchema } = await fx.newSubgraph();
		for (const stmt of emitFactoryDDL(pgSchema))
			await sql.raw(stmt).execute(fx.db);
		const def = factoryDef(base);

		await processBlock(def, def.name, FIRST, { preloaded: mintBlock(FIRST) });

		expect(await factoryAddresses(pgSchema)).toEqual([ADDRESS]);
		expect(await fx.balance(pgSchema)).toBe(1n);
	});

	it("rolls the whole block back when the discovery cannot be stored", async () => {
		await fx.seedCanonical();
		// No `_factory_addresses` table: storing the discovery fails.
		const { def: base, pgSchema } = await fx.newSubgraph();
		const def = factoryDef(base);

		await expect(
			processBlock(def, def.name, FIRST, { preloaded: mintBlock(FIRST) }),
		).rejects.toThrow();

		expect(await fx.balance(pgSchema)).toBeNull();
		expect(Number((await fx.row(def.name)).last_processed_block)).toBe(
			FIRST - 1,
		);
	});
});

describe("catch-up membership cache", () => {
	it("catch-up membership gives the same factory set as per-block resolution", async () => {
		await fx.seedCanonical();
		const { def: base, pgSchema } = await fx.newSubgraph();
		for (const stmt of emitFactoryDDL(pgSchema))
			await sql.raw(stmt).execute(fx.db);
		const def = factoryDef(base);
		await sql
			.raw(
				`INSERT INTO "${pgSchema}"."_factory_addresses" (source_name, address, block_height)
				 VALUES ('registry', 'early', ${FIRST}), ('registry', 'late', ${FIRST + 2})`,
			)
			.execute(fx.db);

		const membership = await loadBatchMembership(def, {
			topHeight: FIRST + 3,
			schemaName: pgSchema,
			db: fx.db,
		});

		for (const height of [FIRST, FIRST + 1, FIRST + 2, FIRST + 3]) {
			const perBlock = await resolveFactoryContracts(
				def,
				height,
				pgSchema,
				fx.db,
				[],
				[],
			);
			expect(
				membership.factoryAsOf(height) as Map<string, ReadonlySet<string>>,
			).toEqual(perBlock.resolved);
		}
		expect([
			...(membership.factoryAsOf(FIRST + 1).get("registry") ?? []),
		]).toEqual(["early"]);
	});

	it("multi-row discovery insert stores every discovery of the block", async () => {
		await fx.seedCanonical();
		const { def: base, pgSchema } = await fx.newSubgraph();
		for (const stmt of emitFactoryDDL(pgSchema))
			await sql.raw(stmt).execute(fx.db);
		const def = factoryDef(base);
		const block = mintBlock(FIRST);
		const [first] = block.events;
		block.events.push({
			...first,
			id: crypto.randomUUID(),
			event_index: 1,
			data: { ...(first.data as object), recipient: "SPOTHERRECIPIENT" },
		});

		const result = await processBlock(def, def.name, FIRST, {
			preloaded: block,
		});

		const { rows } = await sql
			.raw(
				`SELECT address, block_height FROM "${pgSchema}"."_factory_addresses" ORDER BY address`,
			)
			.execute(fx.db);
		expect(
			(rows as { address: string; block_height: string | number }[]).map(
				(r) => [r.address, Number(r.block_height)],
			),
		).toEqual([
			[ADDRESS, FIRST],
			["SPOTHERRECIPIENT", FIRST],
		]);
		expect(result.discovered?.length).toBe(2);
	});
});
