import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as upCoverage } from "../migrations/0116_coverage_schema.ts";
import {
	DECODER_COMMIT_STEPS,
	DecoderAdapterCrash,
	type DecoderAdapterReceipt,
	type DecoderCommitStep,
	commitDecoderAdapter,
} from "../src/coverage/adapter.ts";
import { inputDigest } from "../src/coverage/decoder-clock.ts";
import { setMigrationRole } from "../src/db/migration-role.ts";
import { hasTestDb } from "../src/db/test-helpers.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = hasTestDb("decoder adapter crash matrix");

function adapterReceipt(height: number): DecoderAdapterReceipt {
	const cursors = [`${height}:0`];
	return {
		height,
		hash: `0x${height}`,
		input_count: 1,
		input_cursors: cursors,
		input_digest: inputDigest(cursors),
		through_cursor: `${height}:0`,
		no_match: false,
		effect_digest: "e",
	};
}

describe.skipIf(!HAS_DB)("crash matrix (postgres)", () => {
	async function withSchema(
		fn: (db: Kysely<Database>) => Promise<void>,
	): Promise<void> {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
		const schema = `adapter_0116_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<Database>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		setMigrationRole("both");
		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
			await upCoverage(db as Kysely<unknown>);
			await sql`
				CREATE TABLE decoder_checkpoints (
					decoder_name TEXT PRIMARY KEY,
					last_cursor TEXT,
					updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
				)
			`.execute(db);
			await sql`
				CREATE TABLE decoder_output (
					id TEXT PRIMARY KEY,
					payload TEXT NOT NULL
				)
			`.execute(db);
			await fn(db);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
			await client.end();
		}
	}

	async function counts(db: Kysely<Database>): Promise<{
		output: number;
		checkpoints: number;
		receipts: number;
		failures: number;
	}> {
		const [output, checkpoints, receipts, failures] = await Promise.all([
			sql<{
				n: string;
			}>`SELECT count(*)::text AS n FROM decoder_output`.execute(db),
			sql<{
				n: string;
			}>`SELECT count(*)::text AS n FROM decoder_checkpoints`.execute(db),
			sql<{
				n: string;
			}>`SELECT count(*)::text AS n FROM stage_block_receipts`.execute(db),
			sql<{
				n: string;
			}>`SELECT count(*)::text AS n FROM stage_failures`.execute(db),
		]);
		return {
			output: Number(output.rows[0]?.n ?? 0),
			checkpoints: Number(checkpoints.rows[0]?.n ?? 0),
			receipts: Number(receipts.rows[0]?.n ?? 0),
			failures: Number(failures.rows[0]?.n ?? 0),
		};
	}

	function commit(
		db: Kysely<Database>,
		crashAfter?: DecoderCommitStep,
		withFailure = true,
	) {
		return commitDecoderAdapter(db, {
			stage_id: "decode:ft_transfer",
			decoder_name: "decode.ft_transfer.v1",
			checkpoint_cursor: "12:0",
			receipts: [adapterReceipt(10), adapterReceipt(11)],
			failure: withFailure
				? {
						unit_kind: "block",
						class: "crash",
						retry_state: "open",
						from_height: 12,
						to_height: 12,
						error: "boom",
					}
				: null,
			crashAfter,
			writeOutput: async (tx) => {
				await sql`
					INSERT INTO decoder_output (id, payload) VALUES ('batch-1', 'ok')
					ON CONFLICT (id) DO UPDATE SET payload = excluded.payload
				`.execute(tx);
			},
		});
	}

	test("a crash after any step leaves no output, checkpoint, receipt, or failure", async () => {
		await withSchema(async (db) => {
			for (const step of DECODER_COMMIT_STEPS) {
				await expect(commit(db, step)).rejects.toBeInstanceOf(
					DecoderAdapterCrash,
				);
				expect(await counts(db)).toEqual({
					output: 0,
					checkpoints: 0,
					receipts: 0,
					failures: 0,
				});
			}
		});
	});

	test("a clean commit writes all four", async () => {
		await withSchema(async (db) => {
			await commit(db);
			expect(await counts(db)).toEqual({
				output: 1,
				checkpoints: 1,
				receipts: 2,
				failures: 1,
			});
			const checkpoint = await db
				.selectFrom("decoder_checkpoints")
				.select("last_cursor")
				.where("decoder_name", "=", "decode.ft_transfer.v1")
				.executeTakeFirst();
			expect(checkpoint?.last_cursor).toBe("12:0");
		});
	});

	test("a second commit of the same receipts is idempotent", async () => {
		await withSchema(async (db) => {
			await commit(db, undefined, false);
			await commit(db, undefined, false);
			expect(await counts(db)).toEqual({
				output: 1,
				checkpoints: 1,
				receipts: 2,
				failures: 0,
			});
		});
	});
});
