import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	LIVE_REWRITE_SPECS,
	type LiveRewriteSpec,
	applyDirtyHeights,
	isLiveRewriteReady,
	readLiveRewriteFacts,
	swapLiveRewrite,
} from "@secondlayer/shared/db/live-rewrite";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	type LiveRewriteCommand,
	parseArgs,
	runLiveRewrite,
} from "./live-rewrite.ts";

const HAS_DB = !!process.env.DATABASE_URL;

async function withAdmin<T>(
	fn: (admin: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> {
	const admin = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
	try {
		return await fn(admin);
	} finally {
		await admin.end();
	}
}

async function createScratchDatabase(): Promise<string> {
	const name = `live_rewrite_${Date.now().toString(36)}_${process.pid}`;
	await withAdmin((admin) => admin.unsafe(`CREATE DATABASE ${name}`));
	const url = new URL(process.env.DATABASE_URL ?? "");
	url.pathname = `/${name}`;
	return url.toString();
}

async function dropScratchDatabase(url: string): Promise<void> {
	const name = new URL(url).pathname.slice(1);
	await withAdmin((admin) =>
		admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
	);
}

function toySpec(table: string): LiveRewriteSpec {
	const next = `${table}_next`;
	return {
		table,
		createNext: sql`
			CREATE TABLE IF NOT EXISTS ${sql.table(next)} (
				block_height BIGINT NOT NULL,
				ordinal INTEGER NOT NULL,
				payload_len INTEGER NOT NULL,
				payload TEXT NOT NULL,
				CONSTRAINT ${sql.id(`${table}_pkey_next`)} PRIMARY KEY (block_height, ordinal)
			)
		`,
		copyRange: (lo, hi) => sql`
			INSERT INTO ${sql.table(next)} (block_height, ordinal, payload_len, payload)
			SELECT block_height, ordinal, length(payload), payload
			  FROM ${sql.table(table)}
			 WHERE block_height >= ${lo} AND block_height < ${hi}
		`,
		sourceRowsInRange: (lo, hi) => sql`
			SELECT count(*) FROM ${sql.table(table)}
			 WHERE block_height >= ${lo} AND block_height < ${hi}
		`,
		skipIndexes: [`${table}_skipped_idx`],
		skipConstraints: [],
		digestLive: (heights) => sql`
			SELECT block_height::int AS block_height, count(*)::int AS n,
			       md5(string_agg(concat_ws('|', ordinal, payload), ',' ORDER BY ordinal)) AS md5
			  FROM ${sql.table(table)}
			 WHERE block_height = ANY(ARRAY[${sql.join(heights)}]::bigint[])
			 GROUP BY block_height
		`,
		digestNext: (heights) => sql`
			SELECT block_height::int AS block_height, count(*)::int AS n,
			       md5(string_agg(concat_ws('|', ordinal, payload), ',' ORDER BY ordinal)) AS md5
			  FROM ${sql.table(next)}
			 WHERE block_height = ANY(ARRAY[${sql.join(heights)}]::bigint[])
			 GROUP BY block_height
		`,
	};
}

describe.skipIf(!HAS_DB)("live table rewrite", () => {
	let url = "";
	let client: ReturnType<typeof postgres>;
	let db: Kysely<unknown>;
	const lines: string[] = [];
	const options = {
		apply: true,
		sample: 50,
		print: (line: string) => lines.push(line),
	};

	beforeAll(async () => {
		url = await createScratchDatabase();
		client = postgres(url, { max: 4, onnotice: () => {} });
		db = new Kysely<unknown>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
	});

	afterAll(async () => {
		await db.destroy();
		await dropScratchDatabase(url);
	});

	async function createToy(table: string): Promise<void> {
		await sql`CREATE TABLE ${sql.table(`${table}_blocks`)} (height BIGINT PRIMARY KEY)`.execute(
			db,
		);
		await sql`
			CREATE TABLE ${sql.table(table)} (
				block_height BIGINT NOT NULL,
				ordinal INTEGER NOT NULL,
				payload TEXT NOT NULL,
				CONSTRAINT ${sql.id(`${table}_pkey`)} PRIMARY KEY (block_height, ordinal),
				CONSTRAINT ${sql.id(`${table}_block_fkey`)} FOREIGN KEY (block_height)
				  REFERENCES ${sql.table(`${table}_blocks`)} (height) ON DELETE CASCADE
			)
		`.execute(db);
		await sql`CREATE INDEX ${sql.id(`${table}_payload_idx`)} ON ${sql.table(table)} (payload, block_height)`.execute(
			db,
		);
		await sql`CREATE INDEX ${sql.id(`${table}_skipped_idx`)} ON ${sql.table(table)} (ordinal)`.execute(
			db,
		);
	}

	async function insertRows(
		table: string,
		rows: [number, number, string][],
	): Promise<void> {
		for (const [height] of rows) {
			await sql`INSERT INTO ${sql.table(`${table}_blocks`)} VALUES (${height}) ON CONFLICT DO NOTHING`.execute(
				db,
			);
		}
		for (const [height, ordinal, payload] of rows) {
			await sql`INSERT INTO ${sql.table(table)} VALUES (${height}, ${ordinal}, ${payload})`.execute(
				db,
			);
		}
	}

	async function run(
		spec: LiveRewriteSpec,
		command: LiveRewriteCommand,
		extra: { maxWindows?: number; apply?: boolean } = {},
	): Promise<number> {
		return runLiveRewrite(db, spec, command, { ...options, ...extra });
	}

	async function names(
		query: ReturnType<typeof sql<{ name: string }>>,
	): Promise<string[]> {
		return (await query.execute(db)).rows.map((r) => r.name).sort();
	}

	test("rewrites a live table through prepare, copy, catchup, index, verify and swap", async () => {
		const table = "toy_events";
		const spec = toySpec(table);
		await createToy(table);
		await insertRows(table, [
			[5, 0, "a"],
			[5, 1, "b"],
			[10_005, 0, "c"],
			[10_005, 1, "d"],
			[20_005, 0, "e"],
			[20_005, 1, "f"],
		]);

		expect(await run(spec, "prepare")).toBe(0);
		expect((await readLiveRewriteFacts(db, spec)).triggerCount).toBe(3);

		await run(spec, "copy", { maxWindows: 1 });
		expect((await readLiveRewriteFacts(db, spec)).copiedBelow).toBe(10_000);

		await insertRows(table, [[5, 9, "late"]]);
		await sql`DELETE FROM ${sql.table(table)} WHERE block_height = 10005 AND ordinal = 0`.execute(
			db,
		);
		await insertRows(table, [[30_001, 0, "newer"]]);

		await run(spec, "copy");
		expect((await readLiveRewriteFacts(db, spec)).copiedBelow).toBe(30_002);

		await sql`UPDATE ${sql.table(table)} SET payload = 'edited' WHERE block_height = 20005 AND ordinal = 1`.execute(
			db,
		);
		await sql`DELETE FROM ${sql.table(`${table}_blocks`)} WHERE height = 30001`.execute(
			db,
		);
		expect(await run(spec, "catchup")).toBe(0);

		const nextRows = await sql<{ h: number; o: number; p: string; l: number }>`
			SELECT block_height::int AS h, ordinal AS o, payload AS p, payload_len AS l
			  FROM ${sql.table(`${table}_next`)} ORDER BY 1, 2
		`.execute(db);
		expect(nextRows.rows).toEqual([
			{ h: 5, o: 0, p: "a", l: 1 },
			{ h: 5, o: 1, p: "b", l: 1 },
			{ h: 5, o: 9, p: "late", l: 4 },
			{ h: 10_005, o: 1, p: "d", l: 1 },
			{ h: 20_005, o: 0, p: "e", l: 1 },
			{ h: 20_005, o: 1, p: "edited", l: 6 },
		]);

		expect(await run(spec, "preflight", { apply: false })).toBe(1);
		expect(lines.some((l) => /NOT READY: indexes missing/.test(l))).toBe(true);

		await run(spec, "index");
		expect(await run(spec, "verify")).toBe(0);
		lines.length = 0;
		expect(await run(spec, "preflight")).toBe(0);
		expect(lines).toContain("READY");

		await insertRows(table, [[40_000, 0, "after-ready"]]);
		await sql`DELETE FROM ${sql.table(table)} WHERE block_height = 5 AND ordinal = 1`.execute(
			db,
		);

		await swapLiveRewrite(db, spec);

		const liveRows = await sql<{ h: number; o: number }>`
			SELECT block_height::int AS h, ordinal AS o FROM ${sql.table(table)} ORDER BY 1, 2
		`.execute(db);
		expect(liveRows.rows).toEqual([
			{ h: 5, o: 0 },
			{ h: 5, o: 9 },
			{ h: 10_005, o: 1 },
			{ h: 20_005, o: 0 },
			{ h: 20_005, o: 1 },
			{ h: 40_000, o: 0 },
		]);
		const oldCount = await sql<{ n: number }>`
			SELECT count(*)::int AS n FROM ${sql.table(`${table}_old`)}
		`.execute(db);
		expect(oldCount.rows[0]?.n).toBe(6);

		expect(
			await names(
				sql`SELECT conname AS name FROM pg_constraint WHERE conrelid = 'toy_events'::regclass`,
			),
		).toEqual(["toy_events_block_fkey", "toy_events_pkey"]);
		expect(
			await names(
				sql`SELECT indexname AS name FROM pg_indexes WHERE tablename = 'toy_events'`,
			),
		).toEqual(["toy_events_payload_idx", "toy_events_pkey"]);
		expect(
			await names(
				sql`SELECT conname AS name FROM pg_constraint WHERE conrelid = 'toy_events_old'::regclass`,
			),
		).toEqual(["toy_events_pkey_old"]);
		expect(
			await names(
				sql`SELECT indexname AS name FROM pg_indexes WHERE tablename = 'toy_events_old'`,
			),
		).toEqual([
			"toy_events_payload_idx_old",
			"toy_events_pkey_old",
			"toy_events_skipped_idx_old",
		]);
		expect(
			await names(
				sql`SELECT tgname AS name FROM pg_trigger WHERE tgrelid = 'toy_events'::regclass AND NOT tgisinternal`,
			),
		).toEqual([]);
		const bookkeeping = await sql<{ n: number }>`
			SELECT (SELECT count(*) FROM live_rewrite_progress)::int
			     + (SELECT count(*) FROM live_rewrite_dirty)::int AS n
		`.execute(db);
		expect(bookkeeping.rows[0]?.n).toBe(0);
	});

	test("refuses to swap before the rewrite is verified", async () => {
		const table = "toy_unready";
		const spec = toySpec(table);
		await createToy(table);
		await insertRows(table, [[1, 0, "x"]]);
		await run(spec, "prepare");
		await run(spec, "copy");

		await expect(swapLiveRewrite(db, spec)).rejects.toThrow(
			/not ready: .*indexes missing.*verify has not passed/,
		);

		const live = await sql<{ n: number }>`
			SELECT count(*)::int AS n FROM ${sql.table(table)}
		`.execute(db);
		expect(live.rows[0]?.n).toBe(1);
		await run(spec, "abort");
	});

	test("abort drops only the tool objects and leaves the live table untouched", async () => {
		const table = "toy_aborted";
		const spec = toySpec(table);
		await createToy(table);
		await insertRows(table, [
			[1, 0, "x"],
			[2, 0, "y"],
		]);
		await run(spec, "prepare");
		await run(spec, "copy");

		expect(await run(spec, "abort")).toBe(0);

		const facts = await readLiveRewriteFacts(db, spec);
		expect(facts.nextExists).toBe(false);
		expect(facts.triggerCount).toBe(0);
		expect(facts.pendingDirtyHeights).toBe(0);
		const live = await sql<{ n: number }>`
			SELECT count(*)::int AS n FROM ${sql.table(table)}
		`.execute(db);
		expect(live.rows[0]?.n).toBe(2);
		await insertRows(table, [[3, 0, "z"]]);
	});

	test("a dry run prints SQL and changes nothing", async () => {
		const table = "toy_dry";
		const spec = toySpec(table);
		await createToy(table);
		const printed: string[] = [];

		const code = await runLiveRewrite(db, spec, "prepare", {
			apply: false,
			sample: 1,
			print: (line) => printed.push(line),
		});

		expect(code).toBe(0);
		expect(printed.join("\n")).toContain("toy_dry_next");
		expect((await readLiveRewriteFacts(db, spec)).nextExists).toBe(false);
	});

	test("dirty heights past the copy frontier are dropped without being copied", async () => {
		const table = "toy_frontier";
		const spec = toySpec(table);
		await createToy(table);
		await insertRows(table, [[1, 0, "x"]]);
		await run(spec, "prepare");
		await run(spec, "copy", { maxWindows: 1 });
		await insertRows(table, [
			[1, 1, "z"],
			[25_000, 0, "y"],
		]);

		const applied = await applyDirtyHeights(db, spec);

		expect(applied).toBe(2);
		const next = await sql<{ n: number }>`
			SELECT count(*)::int AS n FROM ${sql.table(`${table}_next`)}
		`.execute(db);
		expect(next.rows[0]?.n).toBe(2);
		await run(spec, "abort");
	});

	test("a copy whose source rows are not all carried fails loudly", async () => {
		const table = "toy_lossy";
		const base = toySpec(table);
		const spec: LiveRewriteSpec = {
			...base,
			copyRange: (lo, hi) => sql`
				INSERT INTO ${sql.table(`${table}_next`)} (block_height, ordinal, payload_len, payload)
				SELECT block_height, ordinal, length(payload), payload
				  FROM ${sql.table(table)}
				 WHERE block_height >= ${lo} AND block_height < ${hi} AND payload <> 'orphan'
			`,
		};
		await createToy(table);
		await insertRows(table, [
			[1, 0, "ok"],
			[1, 1, "orphan"],
		]);
		await run(spec, "prepare");

		await expect(run(spec, "copy")).rejects.toThrow(
			/copy carried 1 rows, source has 2/,
		);
		await run(spec, "abort");
	});

	test("readiness comes from the stored facts", async () => {
		const table = "toy_facts";
		const spec = toySpec(table);
		await createToy(table);
		await run(spec, "prepare");

		const verdict = isLiveRewriteReady(await readLiveRewriteFacts(db, spec));

		expect(verdict.ready).toBe(false);
		expect(verdict.reasons.some((r) => /verify has not passed/.test(r))).toBe(
			true,
		);
		await run(spec, "abort");
	});

	test("rejects an unknown command and a missing table", () => {
		expect(() => parseArgs(["--table", "t", "explode"])).toThrow(
			/unknown argument/,
		);
		expect(() => parseArgs(["prepare"])).toThrow(/--table is required/);
		expect(parseArgs(["--table", "t", "copy", "--max-windows", "2"])).toEqual({
			table: "t",
			command: "copy",
			options: { apply: false, maxWindows: 2, sample: 2000 },
		});
	});
});

describe.skipIf(!HAS_DB)("vm_events live rewrite", () => {
	let url = "";
	let client: ReturnType<typeof postgres>;
	let db: Kysely<unknown>;
	const spec = LIVE_REWRITE_SPECS.vm_events as LiveRewriteSpec;
	const options = { apply: true, sample: 50, print: () => {} };

	beforeAll(async () => {
		url = await createScratchDatabase();
		client = postgres(url, { max: 4, onnotice: () => {} });
		db = new Kysely<unknown>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		await sql`CREATE TABLE blocks (height BIGINT PRIMARY KEY)`.execute(db);
		await sql`
			CREATE TABLE transactions (
				tx_id TEXT PRIMARY KEY,
				block_height BIGINT NOT NULL,
				tx_index INTEGER NOT NULL
			)
		`.execute(db);
		await sql`
			CREATE UNIQUE INDEX transactions_height_tx_index_uniq
			ON transactions (block_height, tx_index)
		`.execute(db);
		await sql`
			CREATE TABLE vm_events (
				tx_id TEXT NOT NULL,
				block_height BIGINT NOT NULL,
				ordinal INTEGER NOT NULL,
				type TEXT NOT NULL,
				data JSONB NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT vm_events_pkey PRIMARY KEY (block_height, ordinal),
				CONSTRAINT vm_events_type_check CHECK (type IN ('nested_contract_call','var_set','map_set','map_insert','map_delete')),
				CONSTRAINT vm_events_block_height_fkey FOREIGN KEY (block_height)
					REFERENCES blocks (height) ON DELETE CASCADE,
				CONSTRAINT vm_events_tx_id_fkey FOREIGN KEY (tx_id)
					REFERENCES transactions (tx_id) ON DELETE CASCADE
			)
		`.execute(db);
		await sql`CREATE INDEX vm_events_tx_id_idx ON vm_events (tx_id)`.execute(
			db,
		);
		await sql`
			CREATE INDEX vm_events_type_height_ordinal_idx
			ON vm_events (type, block_height, ordinal)
		`.execute(db);
		await sql`
			CREATE INDEX vm_events_contract_type_height_idx
			ON vm_events ((data->>'contract_identifier'), type, block_height, ordinal)
		`.execute(db);
	});

	afterAll(async () => {
		await db.destroy();
		await dropScratchDatabase(url);
	});

	async function seedBlock(height: number, txIds: string[]): Promise<void> {
		await sql`INSERT INTO blocks VALUES (${height}) ON CONFLICT DO NOTHING`.execute(
			db,
		);
		for (const [index, txId] of txIds.entries()) {
			await sql`INSERT INTO transactions VALUES (${txId}, ${height}, ${index})`.execute(
				db,
			);
			await sql`
				INSERT INTO vm_events (tx_id, block_height, ordinal, type, data)
				VALUES (${txId}, ${height}, ${index}, 'var_set',
				        ${JSON.stringify({ contract_identifier: "SP.c", var_name: txId })}::jsonb)
			`.execute(db);
		}
	}

	test("copies vm rows keyed by tx_index and swaps to the new shape with identical digests", async () => {
		await seedBlock(5, ["0xa", "0xb"]);
		await seedBlock(10_005, ["0xc"]);
		await seedBlock(20_005, ["0xd", "0xe"]);

		await runLiveRewrite(db, spec, "prepare", options);
		await runLiveRewrite(db, spec, "copy", options);
		await seedBlock(20_006, ["0xf"]);
		await runLiveRewrite(db, spec, "index", options);
		expect(await runLiveRewrite(db, spec, "verify", options)).toBe(0);
		expect(await runLiveRewrite(db, spec, "preflight", options)).toBe(0);

		const before = await spec
			.digestLive([5, 10_005, 20_005, 20_006])
			.execute(db);

		await swapLiveRewrite(db, spec);

		const columns = await sql<{ column_name: string }>`
			SELECT column_name FROM information_schema.columns
			 WHERE table_name = 'vm_events' ORDER BY column_name
		`.execute(db);
		expect(columns.rows.map((c) => c.column_name)).toEqual([
			"block_height",
			"data",
			"ordinal",
			"tx_index",
			"type",
		]);
		const constraints = await sql<{ conname: string }>`
			SELECT conname FROM pg_constraint
			 WHERE conrelid = 'vm_events'::regclass ORDER BY conname
		`.execute(db);
		expect(constraints.rows.map((c) => c.conname)).toEqual([
			"vm_events_block_height_fkey",
			"vm_events_pkey",
			"vm_events_type_check",
		]);
		const after = await sql<{ block_height: number; n: number; md5: string }>`
			SELECT n.block_height::int AS block_height, count(*)::int AS n,
			       md5(string_agg(concat_ws(chr(124), n.ordinal, t.tx_id, n.type, n.data::text), chr(10) ORDER BY n.ordinal)) AS md5
			  FROM vm_events n
			  LEFT JOIN transactions t ON t.block_height = n.block_height AND t.tx_index = n.tx_index
			 WHERE n.block_height IN (5, 10005, 20005, 20006)
			 GROUP BY n.block_height ORDER BY 1
		`.execute(db);
		const beforeRows = before.rows as typeof after.rows;
		expect(after.rows).toEqual(
			[...beforeRows].sort((a, b) => a.block_height - b.block_height),
		);
	});
});

describe.skipIf(!HAS_DB)(
	"vm_events live rewrite with a re-mined transaction",
	() => {
		let url = "";
		let client: ReturnType<typeof postgres>;
		let db: Kysely<unknown>;
		const spec = LIVE_REWRITE_SPECS.vm_events as LiveRewriteSpec;

		beforeAll(async () => {
			url = await createScratchDatabase();
			client = postgres(url, { max: 2, onnotice: () => {} });
			db = new Kysely<unknown>({
				dialect: new PostgresJSDialect({ postgres: client }),
			});
			await sql`CREATE TABLE blocks (height BIGINT PRIMARY KEY)`.execute(db);
			await sql`
			CREATE TABLE transactions (
				tx_id TEXT PRIMARY KEY, block_height BIGINT NOT NULL, tx_index INTEGER NOT NULL
			)
		`.execute(db);
			await sql`
			CREATE TABLE vm_events (
				tx_id TEXT NOT NULL, block_height BIGINT NOT NULL, ordinal INTEGER NOT NULL,
				type TEXT NOT NULL, data JSONB NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT vm_events_pkey PRIMARY KEY (block_height, ordinal)
			)
		`.execute(db);
		});

		afterAll(async () => {
			await db.destroy();
			await dropScratchDatabase(url);
		});

		test("the copy stops and names the window when a vm row's transaction sits at another height", async () => {
			await sql`INSERT INTO blocks VALUES (10), (11)`.execute(db);
			await sql`INSERT INTO transactions VALUES ('0xmoved', 11, 0)`.execute(db);
			await sql`
			INSERT INTO vm_events (tx_id, block_height, ordinal, type, data)
			VALUES ('0xmoved', 10, 0, 'var_set', '{}')
		`.execute(db);
			await runLiveRewrite(db, spec, "prepare", {
				apply: true,
				sample: 1,
				print: () => {},
			});

			await expect(
				runLiveRewrite(db, spec, "copy", {
					apply: true,
					sample: 1,
					print: () => {},
				}),
			).rejects.toThrow(
				/vm_events heights \[0, 11\): copy carried 0 rows, source has 1/,
			);
		});
	},
);
