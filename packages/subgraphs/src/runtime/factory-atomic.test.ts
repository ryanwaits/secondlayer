import { afterAll, describe, expect, it } from "bun:test";
import { sql } from "@secondlayer/shared/db";
import { emitFactoryDDL } from "../schema/generator.ts";
import type { SubgraphDefinition, SubgraphHandler } from "../types.ts";
import { processBlock } from "./block-processor.ts";
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
