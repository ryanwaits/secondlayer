import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type {
	Database,
	Event,
	Subgraph,
	Transaction,
} from "@secondlayer/shared/db";
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
 * Shared fixtures for reorg tests: an accumulating `ft_mint` subgraph (one
 * `balances` row that every block increments) over a seeded `blocks` table.
 * Each test file takes its own height range so files never collide.
 */

export const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t";
export const ADDRESS = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

export const oldHash = (h: number) => `0xold${h}`;
export const newHash = (h: number) => `0xnew${h}`;

export function makeMintDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: { mint: { type: "ft_mint", assetIdentifier: ASSET } },
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

export function mintBlock(height: number): PreloadedBlockData {
	const tx = {
		tx_id: `0xtx${height}`,
		block_height: height,
		tx_index: 0,
		type: "contract_call",
		sender: ADDRESS,
		status: "success",
		contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t",
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
		data: { asset_identifier: ASSET, amount: "1", recipient: ADDRESS },
		created_at: new Date(0),
	} as Event;
	return {
		block: {
			height,
			hash: oldHash(height),
			parent_hash: oldHash(height - 1),
			burn_block_height: height,
			burn_block_hash: null,
			index_block_hash: null,
			tx_count: null,
			event_count: null,
			timestamp: 1_700_000_000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs: [tx],
		events: [event],
	};
}

export class ReorgFixture {
	readonly db: Kysely<Database> = getDb();
	readonly schemas: string[] = [];
	readonly names: string[] = [];
	readonly accountId = randomUUID();

	constructor(
		readonly first: number,
		readonly last: number,
	) {}

	async seedCanonical(hash: (h: number) => string = oldHash): Promise<void> {
		await this.db
			.deleteFrom("blocks")
			.where("height", ">=", this.first)
			.execute();
		await this.db
			.deleteFrom("chain_reorgs")
			.where("fork_point_height", ">=", this.first)
			.execute();
		await this.db
			.insertInto("blocks")
			.values(
				Array.from({ length: this.last - this.first + 1 }, (_, i) => ({
					height: this.first + i,
					hash: hash(this.first + i),
					parent_hash: hash(this.first + i - 1),
					burn_block_height: this.first + i,
					burn_block_hash: null,
					timestamp: 1_700_000_000 + i,
					canonical: true,
				})),
			)
			.execute();
	}

	async newSubgraph(status: Subgraph["status"] = "active"): Promise<{
		def: SubgraphDefinition;
		pgSchema: string;
	}> {
		const id = randomUUID().slice(0, 8);
		const pgSchema = `sg_rw_${id}`;
		this.schemas.push(pgSchema);
		await sql.raw(`CREATE SCHEMA "${pgSchema}"`).execute(this.db);
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
			.execute(this.db);
		for (const stmt of emitJournalDDL(pgSchema))
			await sql.raw(stmt).execute(this.db);
		const def = makeMintDef(`reorg-rw-${id}`);
		this.names.push(def.name);
		await this.db
			.insertInto("subgraphs")
			.values({
				name: def.name,
				status,
				definition: def as unknown as Record<string, unknown>,
				schema_hash: "test",
				handler_path: "test",
				schema_name: pgSchema,
				account_id: this.accountId,
				last_processed_block: this.first - 1,
			})
			.execute();
		return { def, pgSchema };
	}

	async walk(def: SubgraphDefinition, from: number, to: number) {
		for (let h = from; h <= to; h++) {
			await processBlock(def, def.name, h, { preloaded: mintBlock(h) });
		}
	}

	async balance(pgSchema: string): Promise<bigint | null> {
		const { rows } = await sql
			.raw(`SELECT balance FROM "${pgSchema}"."balances"`)
			.execute(this.db);
		const row = (rows as { balance: string }[])[0];
		return row ? BigInt(row.balance) : null;
	}

	async row(name: string): Promise<Subgraph> {
		return this.db
			.selectFrom("subgraphs")
			.selectAll()
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
	}

	/** The orphaned heights have no canonical block until the replacement lands. */
	async orphan(fromHeight: number): Promise<void> {
		await this.db
			.updateTable("blocks")
			.set({ canonical: false })
			.where("height", ">=", fromHeight)
			.where("height", "<=", this.last)
			.execute();
	}

	async cleanup(): Promise<void> {
		for (const name of this.names) {
			await this.db.deleteFrom("subgraphs").where("name", "=", name).execute();
		}
		for (const s of this.schemas) {
			await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(this.db);
		}
		await this.db
			.deleteFrom("blocks")
			.where("height", ">=", this.first)
			.execute();
		await this.db
			.deleteFrom("chain_reorgs")
			.where("fork_point_height", ">=", this.first)
			.execute();
	}
}
