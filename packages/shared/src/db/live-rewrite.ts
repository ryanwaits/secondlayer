import { type Kysely, type RawBuilder, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: the tool runs against arbitrary tables, outside the typed schema
export type LiveRewriteDb = Kysely<any>;

export type LiveRewriteSpec = {
	table: string;
	createNext: RawBuilder<unknown>;
	copyRange: (fromHeight: number, toHeight: number) => RawBuilder<unknown>;
	sourceRowsInRange: (
		fromHeight: number,
		toHeight: number,
	) => RawBuilder<unknown>;
	skipIndexes: readonly string[];
	skipConstraints: readonly string[];
	digestLive: (heights: readonly number[]) => RawBuilder<unknown>;
	digestNext: (heights: readonly number[]) => RawBuilder<unknown>;
};

const vmEventsSpec: LiveRewriteSpec = {
	table: "vm_events",
	createNext: sql`
		CREATE TABLE IF NOT EXISTS vm_events_next (
		  block_height BIGINT NOT NULL,
		  ordinal INTEGER NOT NULL,
		  tx_index INTEGER NOT NULL,
		  type TEXT NOT NULL,
		  data JSONB NOT NULL,
		  CONSTRAINT vm_events_pkey_next PRIMARY KEY (block_height, ordinal),
		  CONSTRAINT vm_events_type_check_next CHECK (type IN ('nested_contract_call','var_set','map_set','map_insert','map_delete'))
		)
	`,
	copyRange: (fromHeight, toHeight) => sql`
		INSERT INTO vm_events_next (block_height, ordinal, tx_index, type, data)
		SELECT src.block_height, src.ordinal, t.tx_index, src.type, src.data
		  FROM vm_events src
		  JOIN transactions t ON t.tx_id = src.tx_id AND t.block_height = src.block_height
		 WHERE src.block_height >= ${fromHeight} AND src.block_height < ${toHeight}
	`,
	sourceRowsInRange: (fromHeight, toHeight) => sql`
		SELECT count(*) FROM vm_events
		 WHERE block_height >= ${fromHeight} AND block_height < ${toHeight}
	`,
	skipIndexes: ["vm_events_tx_id_idx"],
	skipConstraints: ["vm_events_tx_id_fkey"],
	digestLive: (heights) => sql`
		SELECT block_height::int AS block_height, count(*)::int AS n,
		       md5(string_agg(concat_ws(chr(124), ordinal, tx_id, type, data::text), chr(10) ORDER BY ordinal)) AS md5
		  FROM vm_events
		 WHERE block_height = ANY(ARRAY[${sql.join(heights)}]::bigint[])
		 GROUP BY block_height
	`,
	digestNext: (heights) => sql`
		SELECT n.block_height::int AS block_height, count(*)::int AS n,
		       md5(string_agg(concat_ws(chr(124), n.ordinal, t.tx_id, n.type, n.data::text), chr(10) ORDER BY n.ordinal)) AS md5
		  FROM vm_events_next n
		  LEFT JOIN transactions t ON t.block_height = n.block_height AND t.tx_index = n.tx_index
		 WHERE n.block_height = ANY(ARRAY[${sql.join(heights)}]::bigint[])
		 GROUP BY n.block_height
	`,
};

const CANONICAL_HEX = "^([0-9a-f]{2})*$";

function stateWritesDigest(table: string, valueHex: RawBuilder<unknown>) {
	return (heights: readonly number[]) => sql`
		SELECT block_height::int AS block_height, count(*)::int AS n,
		       md5(string_agg(concat_ws(chr(124), ordinal, tx_index, key, ${valueHex}), chr(10) ORDER BY ordinal)) AS md5
		  FROM ${sql.table(table)}
		 WHERE block_height = ANY(ARRAY[${sql.join(heights)}]::bigint[])
		 GROUP BY block_height
	`;
}

const stateWritesSpec: LiveRewriteSpec = {
	table: "state_writes",
	createNext: sql`
		CREATE TABLE IF NOT EXISTS state_writes_next (
			block_height BIGINT NOT NULL,
			ordinal INTEGER NOT NULL,
			tx_index INTEGER NULL,
			key TEXT NOT NULL,
			value BYTEA NOT NULL,
			CONSTRAINT state_writes_pkey_next PRIMARY KEY (block_height, ordinal)
		)
	`,
	copyRange: (fromHeight, toHeight) => sql`
		INSERT INTO state_writes_next (block_height, ordinal, tx_index, key, value)
		SELECT block_height, ordinal, tx_index, key, decode(value_hex, 'hex')
		  FROM state_writes
		 WHERE block_height >= ${fromHeight} AND block_height < ${toHeight}
		   AND value_hex ~ ${CANONICAL_HEX}
	`,
	sourceRowsInRange: (fromHeight, toHeight) => sql`
		SELECT count(*) FROM state_writes
		 WHERE block_height >= ${fromHeight} AND block_height < ${toHeight}
	`,
	skipIndexes: [],
	skipConstraints: [],
	digestLive: stateWritesDigest("state_writes", sql`value_hex`),
	digestNext: stateWritesDigest("state_writes_next", sql`encode(value, 'hex')`),
};

export const LIVE_REWRITE_SPECS: Record<string, LiveRewriteSpec> = {
	vm_events: vmEventsSpec,
	state_writes: stateWritesSpec,
};

export const LIVE_REWRITE_WINDOW_HEIGHTS = 10_000;
export const LIVE_REWRITE_MAX_PENDING_HEIGHTS = 10_000;
export const LIVE_REWRITE_INDEX_LAG_HEIGHTS = 10_000;
const DEFAULT_DIRTY_BATCH_HEIGHTS = 2_000;
const MAX_IDENTIFIER_LENGTH = 63;
const NEXT_SUFFIX = "_next";
const OLD_SUFFIX = "_old";
const SWAP_LOCK_TIMEOUT = "30s";
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export type LiveRewriteFacts = {
	nextExists: boolean;
	triggerCount: number;
	copiedBelow: number | null;
	liveMaxHeight: number | null;
	missingIndexes: string[];
	invalidIndexes: string[];
	missingConstraints: string[];
	unvalidatedConstraints: string[];
	verifiedAt: Date | null;
	copiedAt: Date | null;
	pendingDirtyHeights: number;
};

export type LiveRewriteReasonCode =
	| "next_missing"
	| "triggers_missing"
	| "copy_incomplete"
	| "indexes_missing"
	| "indexes_invalid"
	| "constraints_missing"
	| "constraints_unvalidated"
	| "unverified"
	| "verify_stale"
	| "dirty_backlog";

export const LIVE_REWRITE_COUNT_REASONS: readonly LiveRewriteReasonCode[] = [
	"copy_incomplete",
	"dirty_backlog",
];

export const LIVE_REWRITE_TRIGGER_COUNT = 3;

export function isLiveRewriteReady(
	facts: LiveRewriteFacts,
	opts: { ignore?: readonly LiveRewriteReasonCode[] } = {},
): { ready: boolean; reasons: string[] } {
	const ignored = new Set(opts.ignore ?? []);
	const reasons: string[] = [];
	const fail = (code: LiveRewriteReasonCode, message: string) => {
		if (!ignored.has(code)) reasons.push(message);
	};

	if (!facts.nextExists) fail("next_missing", "next table does not exist");
	if (facts.triggerCount < LIVE_REWRITE_TRIGGER_COUNT) {
		fail(
			"triggers_missing",
			`dirty-height triggers missing (${facts.triggerCount}/${LIVE_REWRITE_TRIGGER_COUNT})`,
		);
	}
	const copiedBelow = facts.copiedBelow ?? 0;
	if (facts.liveMaxHeight !== null && copiedBelow <= facts.liveMaxHeight) {
		fail(
			"copy_incomplete",
			`copy incomplete: copied_below ${copiedBelow} <= live max height ${facts.liveMaxHeight}`,
		);
	}
	if (facts.missingIndexes.length > 0) {
		fail(
			"indexes_missing",
			`indexes missing: ${facts.missingIndexes.join(", ")}`,
		);
	}
	if (facts.invalidIndexes.length > 0) {
		fail(
			"indexes_invalid",
			`indexes invalid: ${facts.invalidIndexes.join(", ")}`,
		);
	}
	if (facts.missingConstraints.length > 0) {
		fail(
			"constraints_missing",
			`constraints missing: ${facts.missingConstraints.join(", ")}`,
		);
	}
	if (facts.unvalidatedConstraints.length > 0) {
		fail(
			"constraints_unvalidated",
			`constraints not validated: ${facts.unvalidatedConstraints.join(", ")}`,
		);
	}
	if (facts.verifiedAt === null) {
		fail("unverified", "verify has not passed");
	} else if (
		facts.copiedAt !== null &&
		facts.verifiedAt.getTime() < facts.copiedAt.getTime()
	) {
		fail("verify_stale", "verify is older than the last copy window");
	}
	if (facts.pendingDirtyHeights > LIVE_REWRITE_MAX_PENDING_HEIGHTS) {
		fail(
			"dirty_backlog",
			`${facts.pendingDirtyHeights} dirty heights pending (max ${LIVE_REWRITE_MAX_PENDING_HEIGHTS})`,
		);
	}
	return { ready: reasons.length === 0, reasons };
}

export function nextTableName(table: string): string {
	return `${table}${NEXT_SUFFIX}`;
}

export function oldTableName(table: string): string {
	return `${table}${OLD_SUFFIX}`;
}

export function assertIdentifierFits(name: string): void {
	if (name.length > MAX_IDENTIFIER_LENGTH) {
		throw new Error(
			`identifier "${name}" is ${name.length} characters, over the ${MAX_IDENTIFIER_LENGTH} limit`,
		);
	}
}

export function nextIndexName(name: string): string {
	const next = `${name}${NEXT_SUFFIX}`;
	assertIdentifierFits(next);
	assertIdentifierFits(`${name}${OLD_SUFFIX}`);
	return next;
}

export function rewriteIndexDef(
	indexdef: string,
	table: string,
	indexName: string,
): string {
	if (!SIMPLE_IDENTIFIER.test(indexName) || !SIMPLE_IDENTIFIER.test(table)) {
		throw new Error(`cannot rewrite index "${indexName}" on "${table}"`);
	}
	const nextName = nextIndexName(indexName);
	const header = new RegExp(
		`^(CREATE (?:UNIQUE )?INDEX )(?:IF NOT EXISTS )?${indexName} ON (?:ONLY )?(?:public\\.)?${table} `,
	);
	if (!header.test(indexdef)) {
		throw new Error(`unrecognized index definition: ${indexdef}`);
	}
	return indexdef.replace(
		header,
		`$1${nextName} ON public.${nextTableName(table)} `,
	);
}

type IndexRow = { indexname: string; indexdef: string };
type ConstraintRow = { conname: string; def: string };

export type LiveRewriteClonePlan = {
	indexes: { name: string; nextName: string; create: string }[];
	constraints: {
		name: string;
		nextName: string;
		add: string;
		validate: string;
	}[];
};

export async function planClone(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<LiveRewriteClonePlan> {
	const indexRows = await sql<IndexRow>`
		SELECT i.indexname, i.indexdef
		  FROM pg_indexes i
		 WHERE i.schemaname = 'public' AND i.tablename = ${spec.table}
		   AND NOT EXISTS (
		     SELECT 1 FROM pg_constraint c
		      WHERE c.conindid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
		        AND c.contype IN ('p', 'u')
		   )
		 ORDER BY i.indexname
	`.execute(db);
	const indexes = indexRows.rows
		.filter((r) => !spec.skipIndexes.includes(r.indexname))
		.map((r) => ({
			name: r.indexname,
			nextName: nextIndexName(r.indexname),
			create: rewriteIndexDef(r.indexdef, spec.table, r.indexname),
		}));

	const fkRows = await sql<ConstraintRow>`
		SELECT conname, pg_get_constraintdef(oid) AS def
		  FROM pg_constraint
		 WHERE conrelid = to_regclass(${`public.${spec.table}`}) AND contype = 'f'
		 ORDER BY conname
	`.execute(db);
	const next = nextTableName(spec.table);
	const constraints = fkRows.rows
		.filter((r) => !spec.skipConstraints.includes(r.conname))
		.map((r) => {
			const nextName = nextIndexName(r.conname);
			return {
				name: r.conname,
				nextName,
				add: `ALTER TABLE public.${next} ADD CONSTRAINT ${nextName} ${r.def} NOT VALID`,
				validate: `ALTER TABLE public.${next} VALIDATE CONSTRAINT ${nextName}`,
			};
		});
	return { indexes, constraints };
}

function triggerNames(table: string) {
	return {
		fn: `live_rewrite_mark_${table}`,
		ins: `${table}_live_rewrite_ins`,
		upd: `${table}_live_rewrite_upd`,
		del: `${table}_live_rewrite_del`,
	};
}

export async function createBookkeeping(db: LiveRewriteDb): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS live_rewrite_progress (
		  table_name TEXT PRIMARY KEY,
		  copied_below BIGINT NOT NULL DEFAULT 0,
		  verified_at TIMESTAMPTZ,
		  copied_at TIMESTAMPTZ,
		  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);
	await sql`
		CREATE TABLE IF NOT EXISTS live_rewrite_dirty (
		  id BIGSERIAL PRIMARY KEY,
		  table_name TEXT NOT NULL,
		  block_height BIGINT NOT NULL
		)
	`.execute(db);
	await sql`
		CREATE INDEX IF NOT EXISTS live_rewrite_dirty_table_idx
		ON live_rewrite_dirty (table_name, id)
	`.execute(db);
}

export async function installTriggers(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<void> {
	const t = triggerNames(spec.table);
	const table = sql.table(spec.table);
	await sql`
		CREATE OR REPLACE FUNCTION ${sql.id(t.fn)}() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
		  IF TG_OP IN ('INSERT','UPDATE') THEN
		    INSERT INTO live_rewrite_dirty (table_name, block_height)
		      SELECT DISTINCT ${sql.lit(spec.table)}, block_height FROM new_rows;
		  END IF;
		  IF TG_OP IN ('DELETE','UPDATE') THEN
		    INSERT INTO live_rewrite_dirty (table_name, block_height)
		      SELECT DISTINCT ${sql.lit(spec.table)}, block_height FROM old_rows;
		  END IF;
		  RETURN NULL;
		END $$
	`.execute(db);
	await sql`DROP TRIGGER IF EXISTS ${sql.id(t.ins)} ON ${table}`.execute(db);
	await sql`DROP TRIGGER IF EXISTS ${sql.id(t.upd)} ON ${table}`.execute(db);
	await sql`DROP TRIGGER IF EXISTS ${sql.id(t.del)} ON ${table}`.execute(db);
	await sql`
		CREATE TRIGGER ${sql.id(t.ins)} AFTER INSERT ON ${table}
		REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
		EXECUTE FUNCTION ${sql.id(t.fn)}()
	`.execute(db);
	await sql`
		CREATE TRIGGER ${sql.id(t.upd)} AFTER UPDATE ON ${table}
		REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
		EXECUTE FUNCTION ${sql.id(t.fn)}()
	`.execute(db);
	await sql`
		CREATE TRIGGER ${sql.id(t.del)} AFTER DELETE ON ${table}
		REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
		EXECUTE FUNCTION ${sql.id(t.fn)}()
	`.execute(db);
}

export async function dropTriggers(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<void> {
	const t = triggerNames(spec.table);
	const table = sql.table(spec.table);
	await sql`DROP TRIGGER IF EXISTS ${sql.id(t.ins)} ON ${table}`.execute(db);
	await sql`DROP TRIGGER IF EXISTS ${sql.id(t.upd)} ON ${table}`.execute(db);
	await sql`DROP TRIGGER IF EXISTS ${sql.id(t.del)} ON ${table}`.execute(db);
	await sql`DROP FUNCTION IF EXISTS ${sql.id(t.fn)}()`.execute(db);
}

export async function ensureProgressRow(
	db: LiveRewriteDb,
	table: string,
): Promise<void> {
	await sql`
		INSERT INTO live_rewrite_progress (table_name) VALUES (${table})
		ON CONFLICT (table_name) DO NOTHING
	`.execute(db);
}

export async function readLiveRewriteFacts(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<LiveRewriteFacts> {
	const next = nextTableName(spec.table);
	const t = triggerNames(spec.table);
	const nextExists = await tableExists(db, next);
	const bookkeeping = await tableExists(db, "live_rewrite_progress");

	const triggers = await sql<{ n: number }>`
		SELECT count(*)::int AS n FROM pg_trigger
		 WHERE tgrelid = to_regclass(${`public.${spec.table}`})
		   AND tgname IN (${sql.join([t.ins, t.upd, t.del])})
	`.execute(db);

	const live = await sql<{ max: number | null }>`
		SELECT max(block_height)::int AS max FROM ${sql.table(spec.table)}
	`.execute(db);

	let copiedBelow: number | null = null;
	let verifiedAt: Date | null = null;
	let copiedAt: Date | null = null;
	let pending = 0;
	if (bookkeeping) {
		const progress = await sql<{
			copied_below: number;
			verified_at: Date | null;
			copied_at: Date | null;
		}>`
			SELECT copied_below::int AS copied_below, verified_at, copied_at
			  FROM live_rewrite_progress WHERE table_name = ${spec.table}
		`.execute(db);
		const row = progress.rows[0];
		if (row) {
			copiedBelow = row.copied_below;
			verifiedAt = row.verified_at;
			copiedAt = row.copied_at;
		}
		const dirty = await sql<{ n: number }>`
			SELECT count(DISTINCT block_height)::int AS n
			  FROM live_rewrite_dirty WHERE table_name = ${spec.table}
		`.execute(db);
		pending = dirty.rows[0]?.n ?? 0;
	}

	const plan = await planClone(db, spec);
	const missingIndexes: string[] = [];
	const invalidIndexes: string[] = [];
	for (const index of plan.indexes) {
		const found = await sql<{ valid: boolean }>`
			SELECT i.indisvalid AS valid FROM pg_index i
			  JOIN pg_class c ON c.oid = i.indexrelid
			 WHERE c.relname = ${index.nextName} AND c.relnamespace = 'public'::regnamespace
		`.execute(db);
		if (found.rows.length === 0) missingIndexes.push(index.nextName);
		else if (!found.rows[0]?.valid) invalidIndexes.push(index.nextName);
	}
	const missingConstraints: string[] = [];
	const unvalidatedConstraints: string[] = [];
	for (const constraint of plan.constraints) {
		const found = await sql<{ validated: boolean }>`
			SELECT convalidated AS validated FROM pg_constraint
			 WHERE conname = ${constraint.nextName}
			   AND conrelid = to_regclass(${`public.${next}`})
		`.execute(db);
		if (found.rows.length === 0) missingConstraints.push(constraint.nextName);
		else if (!found.rows[0]?.validated) {
			unvalidatedConstraints.push(constraint.nextName);
		}
	}

	return {
		nextExists,
		triggerCount: triggers.rows[0]?.n ?? 0,
		copiedBelow,
		liveMaxHeight: live.rows[0]?.max ?? null,
		missingIndexes,
		invalidIndexes,
		missingConstraints,
		unvalidatedConstraints,
		verifiedAt,
		copiedAt,
		pendingDirtyHeights: pending,
	};
}

async function tableExists(db: LiveRewriteDb, name: string): Promise<boolean> {
	const r = await sql<{ ok: boolean }>`
		SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS ok
	`.execute(db);
	return r.rows[0]?.ok === true;
}

export async function inTransaction<T>(
	db: LiveRewriteDb,
	fn: (trx: LiveRewriteDb) => Promise<T>,
): Promise<T> {
	if (db.isTransaction) return fn(db);
	return db.transaction().execute(fn);
}

async function lockRewrite(db: LiveRewriteDb, table: string): Promise<void> {
	await sql`SELECT pg_advisory_xact_lock(hashtext(${`live_rewrite:${table}`}))`.execute(
		db,
	);
}

export class LiveRewriteCountMismatch extends Error {
	constructor(
		readonly table: string,
		readonly fromHeight: number,
		readonly toHeight: number,
		readonly inserted: number,
		readonly source: number,
	) {
		super(
			`${table} heights [${fromHeight}, ${toHeight}): copy carried ${inserted} rows, source has ${source}`,
		);
	}
}

export async function copyWindow(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	fromHeight: number,
	toHeight: number,
): Promise<number> {
	const result = await sql<{ inserted: number; source: number }>`
		WITH ins AS (${spec.copyRange(fromHeight, toHeight)} RETURNING 1)
		SELECT (SELECT count(*) FROM ins)::int AS inserted,
		       (${spec.sourceRowsInRange(fromHeight, toHeight)})::int AS source
	`.execute(db);
	const row = result.rows[0];
	if (!row || row.inserted !== row.source) {
		throw new LiveRewriteCountMismatch(
			spec.table,
			fromHeight,
			toHeight,
			row?.inserted ?? 0,
			row?.source ?? 0,
		);
	}
	return row.inserted;
}

export async function liveCopyTarget(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<number> {
	const max = await sql<{ max: number | null }>`
		SELECT max(block_height)::int AS max FROM ${sql.table(spec.table)}
	`.execute(db);
	const top = max.rows[0]?.max;
	return top === null || top === undefined ? 0 : top + 1;
}

export type CopiedWindow = { from: number; to: number; rows: number };

export async function copyNextWindow(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: { upTo: number; stampCopiedAt: boolean },
): Promise<CopiedWindow | null> {
	return inTransaction(db, async (trx) => {
		await lockRewrite(trx, spec.table);
		const progress = await sql<{ copied_below: number }>`
			SELECT copied_below::int AS copied_below
			  FROM live_rewrite_progress WHERE table_name = ${spec.table}
		`.execute(trx);
		const from = progress.rows[0]?.copied_below ?? 0;
		if (from >= opts.upTo) return null;
		const to = Math.min(from + LIVE_REWRITE_WINDOW_HEIGHTS, opts.upTo);
		const rows = await copyWindow(trx, spec, from, to);
		await sql`
			UPDATE live_rewrite_progress
			   SET copied_below = ${to},
			       copied_at = CASE WHEN ${opts.stampCopiedAt} THEN now() ELSE copied_at END,
			       updated_at = now()
			 WHERE table_name = ${spec.table}
		`.execute(trx);
		return { from, to, rows };
	});
}

export async function copyToTip(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: { stampCopiedAt: boolean },
): Promise<number> {
	const upTo = await liveCopyTarget(db, spec);
	let rows = 0;
	for (;;) {
		const window = await copyNextWindow(db, spec, { upTo, ...opts });
		if (!window) return rows;
		rows += window.rows;
	}
}

export function contiguousRuns(
	heights: readonly number[],
): { from: number; to: number }[] {
	const sorted = [...new Set(heights)].sort((a, b) => a - b);
	const runs: { from: number; to: number }[] = [];
	for (const h of sorted) {
		const last = runs[runs.length - 1];
		if (last && last.to === h) last.to = h + 1;
		else runs.push({ from: h, to: h + 1 });
	}
	return runs;
}

export async function applyDirtyHeights(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: { maxHeights?: number } = {},
): Promise<number> {
	const limit = opts.maxHeights ?? DEFAULT_DIRTY_BATCH_HEIGHTS;
	const next = sql.table(nextTableName(spec.table));
	return inTransaction(db, async (trx) => {
		await lockRewrite(trx, spec.table);
		const progress = await sql<{ copied_below: number }>`
			SELECT copied_below::int AS copied_below
			  FROM live_rewrite_progress WHERE table_name = ${spec.table}
		`.execute(trx);
		const copiedBelow = progress.rows[0]?.copied_below ?? 0;
		const high = await sql<{ max: number | null }>`
			SELECT max(id)::float8 AS max FROM live_rewrite_dirty
			 WHERE table_name = ${spec.table}
		`.execute(trx);
		const ceiling = high.rows[0]?.max;
		if (ceiling === null || ceiling === undefined) return 0;

		const distinct = await sql<{ block_height: number }>`
			SELECT DISTINCT block_height::int AS block_height
			  FROM live_rewrite_dirty
			 WHERE table_name = ${spec.table} AND id <= ${ceiling}
			 ORDER BY 1
			 LIMIT ${limit}
		`.execute(trx);
		const heights = distinct.rows.map((r) => r.block_height);
		if (heights.length === 0) return 0;

		const applicable = heights.filter((h) => h < copiedBelow);
		if (applicable.length > 0) {
			await sql`
				DELETE FROM ${next} WHERE block_height = ANY(ARRAY[${sql.join(applicable)}]::bigint[])
			`.execute(trx);
			for (const run of contiguousRuns(applicable)) {
				await copyWindow(trx, spec, run.from, run.to);
			}
		}
		await sql`
			DELETE FROM live_rewrite_dirty
			 WHERE table_name = ${spec.table} AND id <= ${ceiling}
			   AND block_height = ANY(ARRAY[${sql.join(heights)}]::bigint[])
		`.execute(trx);
		return heights.length;
	});
}

export async function drainDirtyHeights(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: { maxHeights?: number } = {},
): Promise<number> {
	let total = 0;
	for (;;) {
		const applied = await applyDirtyHeights(db, spec, opts);
		if (applied === 0) return total;
		total += applied;
	}
}

export async function swapLiveRewrite(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<void> {
	await inTransaction(db, async (trx) => {
		const live = sql.table(spec.table);
		const nextName = nextTableName(spec.table);
		const oldName = oldTableName(spec.table);
		await sql`SET LOCAL lock_timeout = ${sql.lit(SWAP_LOCK_TIMEOUT)}`.execute(
			trx,
		);
		await sql`SET LOCAL statement_timeout = 0`.execute(trx);
		await sql`LOCK TABLE ${live} IN ACCESS EXCLUSIVE MODE`.execute(trx);

		const facts = await readLiveRewriteFacts(trx, spec);
		const verdict = isLiveRewriteReady(facts, {
			ignore: LIVE_REWRITE_COUNT_REASONS,
		});
		if (!verdict.ready) {
			throw new Error(
				`${spec.table} live rewrite is not ready: ${verdict.reasons.join("; ")}`,
			);
		}

		await copyToTip(trx, spec, { stampCopiedAt: false });
		while ((await applyDirtyHeights(trx, spec)) > 0) {}

		await dropTriggers(trx, spec);

		const liveFks = await sql<{ conname: string }>`
			SELECT conname FROM pg_constraint
			 WHERE conrelid = to_regclass(${`public.${spec.table}`}) AND contype = 'f'
		`.execute(trx);
		for (const fk of liveFks.rows) {
			await sql`ALTER TABLE ${live} DROP CONSTRAINT ${sql.id(fk.conname)}`.execute(
				trx,
			);
		}

		const liveConstraints = await sql<{ conname: string }>`
			SELECT conname FROM pg_constraint
			 WHERE conrelid = to_regclass(${`public.${spec.table}`})
		`.execute(trx);
		for (const c of liveConstraints.rows) {
			const target = `${c.conname}${OLD_SUFFIX}`;
			assertIdentifierFits(target);
			await sql`
				ALTER TABLE ${live} RENAME CONSTRAINT ${sql.id(c.conname)} TO ${sql.id(target)}
			`.execute(trx);
		}
		const liveIndexes = await sql<{ indexname: string }>`
			SELECT indexname FROM pg_indexes
			 WHERE schemaname = 'public' AND tablename = ${spec.table}
		`.execute(trx);
		for (const i of liveIndexes.rows) {
			if (i.indexname.endsWith(OLD_SUFFIX)) continue;
			const target = `${i.indexname}${OLD_SUFFIX}`;
			assertIdentifierFits(target);
			await sql`ALTER INDEX ${sql.id(i.indexname)} RENAME TO ${sql.id(target)}`.execute(
				trx,
			);
		}
		await sql`ALTER TABLE ${live} RENAME TO ${sql.id(oldName)}`.execute(trx);

		const nextTable = sql.table(nextName);
		const nextConstraints = await sql<{ conname: string }>`
			SELECT conname FROM pg_constraint
			 WHERE conrelid = to_regclass(${`public.${nextName}`})
		`.execute(trx);
		for (const c of nextConstraints.rows) {
			if (!c.conname.endsWith(NEXT_SUFFIX)) continue;
			const target = c.conname.slice(0, -NEXT_SUFFIX.length);
			await sql`
				ALTER TABLE ${nextTable} RENAME CONSTRAINT ${sql.id(c.conname)} TO ${sql.id(target)}
			`.execute(trx);
		}
		const nextIndexes = await sql<{ indexname: string }>`
			SELECT indexname FROM pg_indexes
			 WHERE schemaname = 'public' AND tablename = ${nextName}
		`.execute(trx);
		for (const i of nextIndexes.rows) {
			if (!i.indexname.endsWith(NEXT_SUFFIX)) continue;
			const target = i.indexname.slice(0, -NEXT_SUFFIX.length);
			await sql`ALTER INDEX ${sql.id(i.indexname)} RENAME TO ${sql.id(target)}`.execute(
				trx,
			);
		}
		await sql`ALTER TABLE ${nextTable} RENAME TO ${sql.id(spec.table)}`.execute(
			trx,
		);

		await sql`DELETE FROM live_rewrite_dirty WHERE table_name = ${spec.table}`.execute(
			trx,
		);
		await sql`DELETE FROM live_rewrite_progress WHERE table_name = ${spec.table}`.execute(
			trx,
		);
	});
}

export async function abortLiveRewrite(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<void> {
	await inTransaction(db, async (trx) => {
		await dropTriggers(trx, spec);
		await sql`DROP TABLE IF EXISTS ${sql.table(nextTableName(spec.table))}`.execute(
			trx,
		);
		if (await tableExists(trx, "live_rewrite_dirty")) {
			await sql`DELETE FROM live_rewrite_dirty WHERE table_name = ${spec.table}`.execute(
				trx,
			);
		}
		if (await tableExists(trx, "live_rewrite_progress")) {
			await sql`DELETE FROM live_rewrite_progress WHERE table_name = ${spec.table}`.execute(
				trx,
			);
		}
	});
}

export type HeightDigest = { block_height: number; n: number; md5: string };

export function diffDigests(
	live: readonly HeightDigest[],
	next: readonly HeightDigest[],
): number[] {
	const liveBy = new Map(live.map((d) => [d.block_height, d]));
	const nextBy = new Map(next.map((d) => [d.block_height, d]));
	const heights = new Set([...liveBy.keys(), ...nextBy.keys()]);
	const differing: number[] = [];
	for (const h of heights) {
		const a = liveBy.get(h);
		const b = nextBy.get(h);
		if (!a || !b || a.n !== b.n || a.md5 !== b.md5) differing.push(h);
	}
	return differing.sort((a, b) => a - b);
}
