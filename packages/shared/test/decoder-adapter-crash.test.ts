import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as upCoverage } from "../migrations/0116_coverage_schema.ts";
import { up as upDropReceipts } from "../migrations/0214_drop_coverage_receipts.ts";
import {
	DECODER_COMMIT_STEPS,
	DecoderAdapterCrash,
	type DecoderCommitStep,
	commitDecoderAdapter,
	rewindDecoderCheckpoint,
} from "../src/coverage/adapter.ts";
import { setMigrationRole } from "../src/db/migration-role.ts";
import { hasTestDb } from "../src/db/test-helpers.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = hasTestDb("decoder adapter crash matrix");

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
			await upDropReceipts(db as Kysely<unknown>);
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
		failures: number;
	}> {
		const [output, checkpoints, failures] = await Promise.all([
			sql<{
				n: string;
			}>`SELECT count(*)::text AS n FROM decoder_output`.execute(db),
			sql<{
				n: string;
			}>`SELECT count(*)::text AS n FROM decoder_checkpoints`.execute(db),
			sql<{
				n: string;
			}>`SELECT count(*)::text AS n FROM stage_failures`.execute(db),
		]);
		return {
			output: Number(output.rows[0]?.n ?? 0),
			checkpoints: Number(checkpoints.rows[0]?.n ?? 0),
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

	test("a crash after any step leaves no output, checkpoint, or failure", async () => {
		await withSchema(async (db) => {
			for (const step of DECODER_COMMIT_STEPS) {
				await expect(commit(db, step)).rejects.toBeInstanceOf(
					DecoderAdapterCrash,
				);
				expect(await counts(db)).toEqual({
					output: 0,
					checkpoints: 0,
					failures: 0,
				});
			}
		});
	});

	test("a clean commit writes output, checkpoint and failure", async () => {
		await withSchema(async (db) => {
			await commit(db);
			expect(await counts(db)).toEqual({
				output: 1,
				checkpoints: 1,
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

	test("a commit never moves a checkpoint backward and only a rewind does", async () => {
		await withSchema(async (db) => {
			const commitAt = (cursor: string) =>
				commitDecoderAdapter(db, {
					stage_id: "decode:ft_transfer",
					decoder_name: "decode.ft_transfer.v1",
					checkpoint_cursor: cursor,
					writeOutput: async () => {},
				});
			const stored = async () =>
				(
					await db
						.selectFrom("decoder_checkpoints")
						.select("last_cursor")
						.where("decoder_name", "=", "decode.ft_transfer.v1")
						.executeTakeFirst()
				)?.last_cursor;

			await commitAt("12:5");
			// Numeric, not textual: "9:0" sorts after "12:5" as a string.
			await commitAt("9:0");
			expect(await stored()).toBe("12:5");
			await commitAt("12:2");
			expect(await stored()).toBe("12:5");
			await commitAt("12:6");
			expect(await stored()).toBe("12:6");

			await rewindDecoderCheckpoint(db, "decode.ft_transfer.v1", "9:0");
			expect(await stored()).toBe("9:0");
		});
	});

	test("a repeated commit without a failure is idempotent", async () => {
		await withSchema(async (db) => {
			await commit(db, undefined, false);
			await commit(db, undefined, false);
			expect(await counts(db)).toEqual({
				output: 1,
				checkpoints: 1,
				failures: 0,
			});
		});
	});

	test("the registry row is written only when a failure is", async () => {
		await withSchema(async (db) => {
			const registered = async () =>
				(
					await sql<{
						n: string;
					}>`SELECT count(*)::text AS n FROM stage_registry WHERE id = 'decode:ft_transfer'`.execute(
						db,
					)
				).rows[0]?.n;
			await commit(db, undefined, false);
			expect(await registered()).toBe("0");
			await commit(db);
			expect(await registered()).toBe("1");
			expect((await counts(db)).failures).toBe(1);
		});
	});
});
