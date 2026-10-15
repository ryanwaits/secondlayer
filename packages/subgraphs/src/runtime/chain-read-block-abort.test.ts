import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Transaction } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { emitJournalDDL } from "../schema/generator.ts";
import type {
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import type { PreloadedBlockData } from "./block-processor.ts";
import { processBlock } from "./block-processor.ts";
import { readContractAt } from "./chain-read.ts";
import type { SubgraphContext } from "./context.ts";

/**
 * A chain read the processor can't complete (no node, node down, cache DB
 * error) must abort the block: the block retries and the subgraph halts
 * rather than committing the block without that event's rows. A contract
 * that answers `err` is deterministic, so it stays a per-event handler error.
 */

process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const HAS_DB = !!process.env.DATABASE_URL;
const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t";
const CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t";
const HOLDER = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";

const TOKEN_ABI = {
	functions: [
		{
			name: "get-decimals",
			access: "read-only",
			args: [],
			outputs: { response: { ok: "uint128", error: "uint128" } },
		},
	],
	variables: [],
	maps: [],
	fungible_tokens: [],
	non_fungible_tokens: [],
} as const;

const schema = {
	mints: {
		columns: {
			address: { type: "principal", indexed: true },
			decimals: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

function makeDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: { mint: { type: "ft_mint", assetIdentifier: ASSET } },
		schema,
		handlers: {
			mint: (async (e: unknown, ctx: SubgraphContext) => {
				const ev = e as { recipient: string };
				const token = readContractAt(ctx, CONTRACT, TOKEN_ABI);
				const decimals = await token.read.getDecimals();
				ctx.upsert("mints", { address: ev.recipient }, { decimals });
			}) as unknown as SubgraphHandler,
		},
	};
}

function makeBlock(height: number): PreloadedBlockData {
	const tx = {
		tx_id: `0xtx${height}_${randomUUID().slice(0, 8)}`,
		block_height: height,
		tx_index: 0,
		type: "contract_call",
		sender: HOLDER,
		status: "success",
		contract_id: CONTRACT,
		function_name: "mint",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	} as Transaction;
	const event = {
		id: randomUUID(),
		tx_id: tx.tx_id,
		block_height: height,
		event_index: 0,
		type: "ft_mint_event",
		data: { asset_identifier: ASSET, amount: "1", recipient: HOLDER },
		created_at: new Date(0),
	} as Event;
	return {
		block: {
			height,
			hash: `0xblock${height}`,
			parent_hash: `0xblock${height - 1}`,
			burn_block_height: height,
			burn_block_hash: null,
			// Unique per run so the read cache never answers for the node.
			index_block_hash: `0x${randomUUID().replace(/-/g, "")}`,
			tx_count: null,
			timestamp: 1700000000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs: [tx],
		events: [event],
	};
}

/** A node that answers every read with `status` and `body`. */
function fakeNode(status: number, body: unknown) {
	const server = Bun.serve({
		port: 0,
		fetch: () => Response.json(body, { status }),
	});
	return {
		url: `http://localhost:${server.port}`,
		stop: () => server.stop(true),
	};
}

let db: Kysely<Database>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const accountId = randomUUID();
const savedRpc = process.env.STACKS_NODE_RPC_URL;

async function setUp(): Promise<{ def: SubgraphDefinition; pgSchema: string }> {
	const id = randomUUID().slice(0, 8);
	const pgSchema = `sg_chainread_${id}`;
	createdSchemas.push(pgSchema);
	await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${pgSchema}"`).execute(db);
	await sql
		.raw(
			`CREATE TABLE "${pgSchema}"."mints" (
				_id BIGSERIAL PRIMARY KEY,
				address TEXT NOT NULL,
				decimals NUMERIC(78, 0),
				_block_height BIGINT NOT NULL,
				_tx_id TEXT NOT NULL,
				_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (address)
			)`,
		)
		.execute(db);
	for (const stmt of emitJournalDDL(pgSchema)) {
		await sql.raw(stmt).execute(db);
	}
	const def = makeDef(`chainread-${id}`);
	createdSubgraphNames.push(def.name);
	await db
		.insertInto("subgraphs")
		.values({
			name: def.name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: accountId,
			last_processed_block: 0,
		})
		.execute();
	return { def, pgSchema };
}

async function rowCount(pgSchema: string): Promise<number> {
	const { rows } = await sql
		.raw(`SELECT count(*)::int AS n FROM "${pgSchema}"."mints"`)
		.execute(db);
	return (rows as { n: number }[])[0]?.n ?? 0;
}

async function cursor(name: string): Promise<number> {
	const row = await db
		.selectFrom("subgraphs")
		.select("last_processed_block")
		.where("name", "=", name)
		.executeTakeFirstOrThrow();
	return Number(row.last_processed_block);
}

describe.skipIf(!HAS_DB)("chain reads inside a block", () => {
	beforeAll(() => {
		db = getDb();
	});

	beforeEach(() => {
		process.env.STACKS_NODE_RPC_URL = "";
	});

	afterEach(async () => {
		for (const name of createdSubgraphNames.splice(0)) {
			await db.deleteFrom("subgraphs").where("name", "=", name).execute();
		}
		for (const s of createdSchemas.splice(0)) {
			await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
		}
	});

	afterAll(() => {
		if (savedRpc === undefined) delete process.env.STACKS_NODE_RPC_URL;
		else process.env.STACKS_NODE_RPC_URL = savedRpc;
	});

	it("a chain read the node cannot answer aborts the block instead of dropping the event", async () => {
		const { def, pgSchema } = await setUp();
		const node = fakeNode(503, { error: "unavailable" });
		process.env.STACKS_NODE_RPC_URL = node.url;
		try {
			await expect(
				processBlock(def, def.name, 1, { preloaded: makeBlock(1) }),
			).rejects.toThrow(/get-decimals/);
		} finally {
			node.stop();
		}
		expect(await rowCount(pgSchema)).toBe(0);
		expect(await cursor(def.name)).toBe(0);
	});

	it("a missing node URL aborts the block", async () => {
		const { def, pgSchema } = await setUp();
		await expect(
			processBlock(def, def.name, 1, { preloaded: makeBlock(1) }),
		).rejects.toThrow(/STACKS_NODE_RPC_URL/);
		expect(await rowCount(pgSchema)).toBe(0);
		expect(await cursor(def.name)).toBe(0);
	});

	it("a contract err response still skips only that event", async () => {
		const { def, pgSchema } = await setUp();
		// `(err u1)`: the contract answered, so the handler's failure is its own.
		const node = fakeNode(200, {
			okay: true,
			result: "0x080100000000000000000000000000000001",
		});
		process.env.STACKS_NODE_RPC_URL = node.url;
		try {
			const result = await processBlock(def, def.name, 1, {
				preloaded: makeBlock(1),
			});
			expect(result.errors).toBe(1);
		} finally {
			node.stop();
		}
		expect(await rowCount(pgSchema)).toBe(0);
		expect(await cursor(def.name)).toBe(1);
	});
});
