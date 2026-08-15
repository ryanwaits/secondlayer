import { afterEach, beforeAll, describe, expect, it } from "bun:test";
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
import type { SubgraphContext } from "./context.ts";

/**
 * Plan f072: the subgraph processor no longer holds SECONDLAYER_SECRETS_KEY
 * — it runs untrusted handler code, in-process, every block, and the key was
 * the thing that made the sandbox spike's two documented-open vectors
 * (same-UID `Bun.file()` reads, `/proc/<pid>/environ` on Linux) dangerous to
 * the master secret. This test proves managed subgraphs are unaffected by
 * the key's absence — the regression that matters.
 */

process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const KEY_ENV = "SECONDLAYER_SECRETS_KEY";
const MODE_ENV = "INSTANCE_MODE";

/** Runs `fn` with no resolvable secrets key: platform mode (no OSS
 *  `.env.local` fallback) plus the env var deleted. Restores both
 *  afterward regardless of outcome. */
function withoutKey<T>(fn: () => Promise<T>): Promise<T> {
	const originalKey = process.env[KEY_ENV];
	const originalMode = process.env[MODE_ENV];
	process.env[MODE_ENV] = "platform";
	delete process.env[KEY_ENV];
	return fn().finally(() => {
		if (originalKey === undefined) delete process.env[KEY_ENV];
		else process.env[KEY_ENV] = originalKey;
		if (originalMode === undefined) delete process.env[MODE_ENV];
		else process.env[MODE_ENV] = originalMode;
	});
}

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

function makeMintDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: {
			mint: {
				type: "ft_mint",
				assetIdentifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t",
			},
		},
		schema,
		handlers: {
			mint: (async (e: unknown, ctx: SubgraphContext) => {
				const ev = e as { recipient: string; amount: bigint };
				ctx.increment(
					"balances",
					{ address: ev.recipient },
					{ balance: ev.amount },
				);
			}) as unknown as SubgraphHandler,
		},
	};
}

let txCounter = 0;
function makeMintBlock(
	height: number,
	recipient: string,
	amount: string,
): PreloadedBlockData {
	txCounter++;
	const tx = {
		tx_id: `0xtx${height}_${txCounter}`,
		block_height: height,
		tx_index: 0,
		type: "contract_call",
		sender: recipient,
		status: "success",
		contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t",
		function_name: "mint",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	} as Transaction;
	const event: Event = {
		id: randomUUID(),
		tx_id: tx.tx_id,
		block_height: height,
		event_index: 0,
		type: "ft_mint_event",
		data: {
			asset_identifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t",
			amount,
			recipient,
		},
		created_at: new Date(0),
	} as Event;
	return {
		block: {
			height,
			hash: `0xblock${height}`,
			parent_hash: `0xblock${height - 1}`,
			burn_block_height: height,
			burn_block_hash: null,
			index_block_hash: null,
			timestamp: 1700000000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs: [tx],
		events: [event],
	};
}

let db: Kysely<Database>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const accountId = randomUUID();

async function createBalancesTable(pgSchema: string): Promise<void> {
	createdSchemas.push(pgSchema);
	await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${pgSchema}"`).execute(db);
	await sql
		.raw(
			`CREATE TABLE "${pgSchema}"."balances" (
				_id BIGSERIAL PRIMARY KEY,
				address TEXT NOT NULL,
				balance NUMERIC(78, 0),
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
}

async function balanceOf(
	pgSchema: string,
	address: string,
): Promise<bigint | null> {
	const { rows } = await sql
		.raw(
			`SELECT balance FROM "${pgSchema}"."balances" WHERE address = '${address}'`,
		)
		.execute(db);
	const row = (rows as { balance: string }[])[0];
	return row ? BigInt(row.balance) : null;
}

beforeAll(() => {
	db = getDb();
});

afterEach(async () => {
	for (const name of createdSubgraphNames.splice(0)) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas.splice(0)) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
});

describe("managed subgraphs are unaffected by the processor holding no master key", () => {
	it("processes a block and writes rows normally with SECONDLAYER_SECRETS_KEY unset", async () => {
		const pgSchema = `sg_nokey_managed_${randomUUID().slice(0, 8)}`;
		await createBalancesTable(pgSchema);
		const def = makeMintDef(`nokey-managed-${randomUUID().slice(0, 8)}`);
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
				database_url_enc: null,
			})
			.execute();

		const A = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
		const result = await withoutKey(() =>
			processBlock(def, def.name, 1, {
				preloaded: makeMintBlock(1, A, "7"),
			}),
		);

		expect(result.skipped).toBe(false);
		expect(result.errors).toBe(0);
		expect(await balanceOf(pgSchema, A)).toBe(7n);
	});
});
