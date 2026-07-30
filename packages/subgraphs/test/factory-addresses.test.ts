import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { resolveFactoryContracts } from "../src/runtime/block-processor.ts";
import type { SubgraphDefinition } from "../src/types.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const SCHEMA = "sg_factory_addr_test";
const REGISTRY = "SP1REGISTRY000000000000000000000000000000";
// A real principal — the reveal below carries a genuine hex-encoded Clarity
// tuple so the test exercises the actual print decode path, not a hand-shaped
// object the runtime would never see.
const POOL_A = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
/** serializeCV(Cl.tuple({ pool: Cl.principal(POOL_A) })) */
const POOL_A_PRINT_HEX =
	"0x0c0000000104706f6f6c0516a46ff88886c2ef9762d970b4d2c63678835bd39d";
const POOL_B = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";

/**
 * The `_factory_addresses` table carries two guarantees that were previously
 * backed only by code comments:
 *
 *  1. A contract discovered in block N receives its OWN block-N events —
 *     discovery has to run before matching, or the first event from every
 *     newly-revealed contract is silently dropped.
 *  2. The discovered set is height-stamped and rolled back on reorg — without
 *     that, an address announced on an orphaned fork keeps matching forever.
 */
describe.skipIf(!HAS_DB)("factory address set", () => {
	const db = HAS_DB ? getSourceDb() : null;

	const subgraph = {
		name: "factory-test",
		schema: {},
		sources: {
			registry: {
				type: "print_event",
				contractId: REGISTRY,
			},
			swaps: {
				type: "print_event",
				factory: { from: "registry", field: "data.pool" },
			},
		},
		handlers: {},
	} as unknown as SubgraphDefinition;

	beforeEach(async () => {
		if (!db) return;
		await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${SCHEMA}"`)} CASCADE`.execute(
			db,
		);
		await sql`CREATE SCHEMA ${sql.raw(`"${SCHEMA}"`)}`.execute(db);
		// Mirrors schema/generator.ts's emitFactoryDDL.
		await sql`
			CREATE TABLE ${sql.raw(`"${SCHEMA}"."_factory_addresses"`)} (
				source_name TEXT NOT NULL,
				address TEXT NOT NULL,
				block_height BIGINT NOT NULL,
				PRIMARY KEY (source_name, address)
			)
		`.execute(db);
	});

	async function seedDiscovered(address: string, height: number) {
		if (!db) throw new Error("missing db");
		await sql`
			INSERT INTO ${sql.raw(`"${SCHEMA}"."_factory_addresses"`)}
				(source_name, address, block_height)
			VALUES ('registry', ${address}, ${height})
		`.execute(db);
	}

	/** A registry print announcing a new pool address. */
	function registryReveal(valueHex: string) {
		return {
			txs: [
				{
					tx_id: "0xreveal",
					type: "contract_call",
					sender: REGISTRY,
					status: "success",
					tx_index: 0,
					contract_id: REGISTRY,
				},
			],
			evts: [
				{
					id: "e1",
					tx_id: "0xreveal",
					type: "contract_event",
					event_index: 0,
					data: {
						contract_identifier: REGISTRY,
						topic: "print",
						value: valueHex,
					},
				},
			],
		};
	}

	test("an address revealed in this block is already in the block's set", async () => {
		if (!db) throw new Error("missing db");
		const { txs, evts } = registryReveal(POOL_A_PRINT_HEX);

		const { resolved, discovered } = await resolveFactoryContracts(
			subgraph,
			500,
			SCHEMA,
			db,
			txs as never,
			evts as never,
		);

		// This is the whole point of running discovery before matching: without
		// it, POOL_A's own block-500 events would be dropped.
		expect([...(resolved.get("registry") ?? [])]).toContain(POOL_A);
		expect(discovered).toEqual([{ sourceName: "registry", address: POOL_A }]);
	});

	test("previously revealed addresses at or below the height are included", async () => {
		if (!db) throw new Error("missing db");
		await seedDiscovered(POOL_A, 100);

		const { resolved } = await resolveFactoryContracts(
			subgraph,
			500,
			SCHEMA,
			db,
			[],
			[],
		);
		expect([...(resolved.get("registry") ?? [])]).toEqual([POOL_A]);
	});

	test("addresses revealed above the height are not visible yet", async () => {
		if (!db) throw new Error("missing db");
		// Reprocessing block 100 must not see a pool revealed at 900 — otherwise
		// a reindex matches events the original run could not have matched.
		await seedDiscovered(POOL_B, 900);

		const { resolved } = await resolveFactoryContracts(
			subgraph,
			100,
			SCHEMA,
			db,
			[],
			[],
		);
		expect([...(resolved.get("registry") ?? [])]).toEqual([]);
	});

	test("an already-known address is not re-reported as discovered", async () => {
		if (!db) throw new Error("missing db");
		await seedDiscovered(POOL_A, 100);
		const { txs, evts } = registryReveal(POOL_A_PRINT_HEX);

		const { discovered } = await resolveFactoryContracts(
			subgraph,
			500,
			SCHEMA,
			db,
			txs as never,
			evts as never,
		);
		expect(discovered).toEqual([]);
	});

	test("a reorg drops addresses revealed at or above the fork", async () => {
		if (!db) throw new Error("missing db");
		await seedDiscovered(POOL_A, 100);
		await seedDiscovered(POOL_B, 900);

		// The statement runtime/reorg.ts runs. `>=` is deliberate: the fork block
		// itself is replaced, so an address revealed IN it is off-chain too.
		await sql`
			DELETE FROM ${sql.raw(`"${SCHEMA}"."_factory_addresses"`)}
			WHERE block_height >= ${900}
		`.execute(db);

		const { resolved } = await resolveFactoryContracts(
			subgraph,
			1000,
			SCHEMA,
			db,
			[],
			[],
		);
		const addresses = [...(resolved.get("registry") ?? [])];
		expect(addresses).toContain(POOL_A);
		// Without the rollback, a pool announced on an orphaned fork keeps
		// matching forever.
		expect(addresses).not.toContain(POOL_B);
	});

	test("a missing table is an empty set, not a failed block", async () => {
		if (!db) throw new Error("missing db");
		await sql`DROP TABLE ${sql.raw(`"${SCHEMA}"."_factory_addresses"`)}`.execute(
			db,
		);

		const { resolved } = await resolveFactoryContracts(
			subgraph,
			500,
			SCHEMA,
			db,
			[],
			[],
		);
		expect([...(resolved.get("registry") ?? [])]).toEqual([]);
	});
});
