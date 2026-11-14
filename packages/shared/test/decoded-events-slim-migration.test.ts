import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	INLINE_BUILD_MAX_BYTES,
	down,
	shouldRebuildFilterIndexes,
	up,
} from "../migrations/0211_decoded_events_slim.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const FILTER_INDEXES = [
	"decoded_events_contract_height_event_idx",
	"decoded_events_sender_height_event_idx",
	"decoded_events_recipient_height_event_idx",
];
const DROPPED_INDEXES = [
	"decoded_events_event_type_idx",
	"decoded_events_tx_id_event_index_idx",
];
const DROPPED_COLUMNS = ["source_cursor", "microblock_hash"];

type Db = Kysely<unknown>;

async function indexDefs(db: Db): Promise<Record<string, string>> {
	const { rows } = await sql<{ indexname: string; indexdef: string }>`
		SELECT indexname, indexdef FROM pg_indexes
		WHERE schemaname = current_schema() AND tablename = 'decoded_events'
	`.execute(db);
	return Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
}

async function columns(db: Db): Promise<string[]> {
	const { rows } = await sql<{ column_name: string }>`
		SELECT column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'decoded_events'
		ORDER BY column_name
	`.execute(db);
	return rows.map((row) => row.column_name);
}

async function payloadCompression(db: Db): Promise<string> {
	const { rows } = await sql<{ attcompression: string }>`
		SELECT attcompression FROM pg_attribute
		WHERE attrelid = 'decoded_events'::regclass AND attname = 'payload'
	`.execute(db);
	return rows[0]?.attcompression ?? "";
}

/** `decoded_events` as it stood before the migration (0065, 0066, 0080, 0087). */
async function createLegacyTable(db: Db) {
	await sql`
		CREATE TABLE decoded_events (
			cursor TEXT PRIMARY KEY,
			block_height BIGINT NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INT NOT NULL,
			event_index INT NOT NULL,
			event_type TEXT NOT NULL,
			microblock_hash TEXT,
			canonical BOOLEAN NOT NULL DEFAULT true,
			contract_id TEXT,
			sender TEXT,
			recipient TEXT,
			amount TEXT,
			asset_identifier TEXT,
			value TEXT,
			memo TEXT,
			payload JSONB,
			source_cursor TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);
	await sql`CREATE INDEX decoded_events_block_height_idx ON decoded_events (block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_event_type_idx ON decoded_events (event_type)`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_tx_id_event_index_idx ON decoded_events (tx_id, event_index)`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_contract_height_event_idx ON decoded_events (contract_id, block_height, event_index)`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_sender_height_event_idx ON decoded_events (sender, block_height, event_index)`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_recipient_height_event_idx ON decoded_events (recipient, block_height, event_index)`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_evt_canon_created_idx ON decoded_events (event_type, canonical, created_at DESC)`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_type_height_event_idx ON decoded_events (event_type, block_height, event_index) WHERE canonical`.execute(
		db,
	);
}

async function withSchema(run: (db: Db) => Promise<void>) {
	if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
	const schema = `migration_decoded_slim_${Date.now().toString(36)}`;
	const client = postgres(process.env.DATABASE_URL, {
		max: 1,
		onnotice: () => {},
	});
	const db = new Kysely<unknown>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	try {
		await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
		await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
		await run(db);
	} finally {
		await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
		await db.destroy();
	}
}

function expectSlimShape(defs: Record<string, string>, cols: string[]) {
	for (const name of FILTER_INDEXES) {
		expect(defs[name]).toContain("IS NOT NULL");
	}
	for (const name of DROPPED_INDEXES) expect(defs[name]).toBeUndefined();
	for (const column of DROPPED_COLUMNS) expect(cols).not.toContain(column);
}

describe("decoded_events slim size gate", () => {
	test("rebuilds filter indexes only while the table is at most 1 GiB", () => {
		expect(INLINE_BUILD_MAX_BYTES).toBe(1024 ** 3);
		expect(shouldRebuildFilterIndexes(0)).toBe(true);
		expect(shouldRebuildFilterIndexes(1024 ** 3)).toBe(true);
		expect(shouldRebuildFilterIndexes(1024 ** 3 + 1)).toBe(false);
	});
});

describe.skipIf(!HAS_DB)("decoded_events slim migration", () => {
	test("a fully migrated database has partial filter indexes, no dead indexes or columns, and lz4 payloads", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<unknown>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		try {
			expectSlimShape(await indexDefs(db), await columns(db));
			expect(await payloadCompression(db)).toBe("l");
		} finally {
			await db.destroy();
		}
	});

	test("upgrading a legacy table applies the slim shape and the planner still uses the partial indexes", async () => {
		await withSchema(async (db) => {
			await createLegacyTable(db);
			await up(db);

			expectSlimShape(await indexDefs(db), await columns(db));
			expect(await payloadCompression(db)).toBe("l");

			// Enough rows, spread over many contracts, for the planner to see the
			// contract/sender/recipient filters as selective. Prints carry no
			// sender or recipient, like the real table.
			await sql`
				INSERT INTO decoded_events
					(cursor, block_height, tx_id, tx_index, event_index, event_type, contract_id, sender, recipient)
				SELECT
					n || ':0', n, 'tx' || n, 0, 0,
					CASE WHEN n % 2 = 0 THEN 'print' ELSE 'ft_transfer' END,
					'SP' || (n % 200) || '.c',
					CASE WHEN n % 2 = 0 THEN NULL ELSE 'SPS' || (n % 200) END,
					CASE WHEN n % 2 = 0 THEN NULL ELSE 'SPR' || (n % 200) END
				FROM generate_series(1, 5000) AS n
			`.execute(db);

			await sql`ANALYZE decoded_events`.execute(db);

			const plan = async (query: ReturnType<typeof sql>) => {
				const trx = await sql`BEGIN`.execute(db);
				void trx;
				try {
					await sql`SET LOCAL enable_seqscan = off`.execute(db);
					const { rows } = await sql<{ "QUERY PLAN": string }>`
						EXPLAIN ${query}
					`.execute(db);
					return rows.map((row) => row["QUERY PLAN"]).join("\n");
				} finally {
					await sql`ROLLBACK`.execute(db);
				}
			};

			expect(
				await plan(sql`
					SELECT cursor FROM decoded_events
					WHERE canonical = true AND event_type = 'ft_transfer' AND sender = 'SPS1'
					ORDER BY sender, block_height, event_index LIMIT 10
				`),
			).toContain("decoded_events_sender_height_event_idx");
			expect(
				await plan(sql`
					SELECT cursor FROM decoded_events
					WHERE canonical = true AND event_type = 'ft_transfer' AND recipient = 'SPR1'
					ORDER BY recipient, block_height, event_index LIMIT 10
				`),
			).toContain("decoded_events_recipient_height_event_idx");
			expect(
				await plan(sql`
					SELECT cursor FROM decoded_events
					WHERE contract_id IN ('SP2.c', 'SP4.c') AND event_type = 'print' AND canonical
					ORDER BY contract_id, block_height, event_index LIMIT 10
				`),
			).toContain("decoded_events_contract_height_event_idx");
		});
	});

	test("down then up restores the old shape and then the slim shape again", async () => {
		await withSchema(async (db) => {
			await createLegacyTable(db);
			const legacyColumns = await columns(db);
			const legacyIndexes = Object.keys(await indexDefs(db)).sort();

			await up(db);
			const slimColumns = await columns(db);
			const slimIndexes = Object.keys(await indexDefs(db)).sort();
			await sql`
				INSERT INTO decoded_events (cursor, block_height, tx_id, tx_index, event_index, event_type)
				VALUES ('5:0', 5, 'tx', 0, 0, 'print')
			`.execute(db);

			await down(db);
			const downDefs = await indexDefs(db);
			expect(await columns(db)).toEqual(legacyColumns);
			expect(Object.keys(downDefs).sort()).toEqual(legacyIndexes);
			for (const name of FILTER_INDEXES) {
				expect(downDefs[name]).not.toContain("IS NOT NULL");
			}
			expect(await payloadCompression(db)).toBe("p");
			const { rows } = await sql<{ source_cursor: string }>`
				SELECT source_cursor FROM decoded_events
			`.execute(db);
			expect(rows).toEqual([{ source_cursor: "5:0" }]);

			await up(db);
			expect(await columns(db)).toEqual(slimColumns);
			expect(Object.keys(await indexDefs(db)).sort()).toEqual(slimIndexes);
		});
	});
});
