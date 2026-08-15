import { createHash } from "node:crypto";
import { type Kysely, sql } from "kysely";

/**
 * A normalized snapshot of a Postgres schema: object key → canonical descriptor.
 *
 * Keys are stable, human-readable identities ("column blocks.height",
 * "index blocks.idx_blocks_height") so a mismatch names the object that
 * diverged instead of dumping two schemas at the reader. Values are the parts
 * of the definition an application actually depends on.
 */
export type SchemaSnapshot = Record<string, string>;

export interface SchemaDiffEntry {
	key: string;
	/** Descriptor in the reference schema, or undefined when only B has it. */
	a?: string;
	/** Descriptor in the compared schema, or undefined when only A has it. */
	b?: string;
}

const IGNORED_TABLES = new Set([
	// kysely bookkeeping: row contents legitimately differ between a fresh
	// install and an upgrade (executed_at timestamps), and the tables' shape is
	// owned by kysely, not by this repo's migrations.
	"kysely_migration",
	"kysely_migration_lock",
]);

function descriptor(parts: Record<string, unknown>): string {
	return Object.entries(parts)
		.map(([k, v]) => `${k}=${v === null || v === undefined ? "∅" : v}`)
		.join(" ");
}

interface ColumnRow {
	table_name: string;
	column_name: string;
	data_type: string;
	udt_name: string;
	is_nullable: string;
	column_default: string | null;
	character_maximum_length: number | null;
	numeric_precision: number | null;
	numeric_scale: number | null;
	datetime_precision: number | null;
	is_identity: string;
	identity_generation: string | null;
	is_generated: string;
	generation_expression: string | null;
	collation_name: string | null;
}

interface IndexRow {
	tablename: string;
	indexname: string;
	indexdef: string;
}

interface ConstraintRow {
	table_name: string;
	conname: string;
	contype: string;
	def: string;
}

interface EnumRow {
	typname: string;
	enumlabel: string;
}

interface ViewRow {
	table_name: string;
	view_definition: string | null;
	kind: string;
}

interface SequenceRow {
	sequence_name: string;
	data_type: string;
	start_value: string;
	increment: string;
	minimum_value: string;
	maximum_value: string;
	cycle_option: string;
}

interface RoutineRow {
	name: string;
	def: string;
}

interface TriggerRow {
	relname: string;
	tgname: string;
	def: string;
}

/**
 * Read the shape of `schema` (default `public`) out of information_schema and
 * pg_catalog.
 *
 * Normalizations, and why each one is safe:
 *  - Column ordinal position is dropped. Physical order is an artifact of how a
 *    table was built (created with the column vs. ALTER TABLE ADD COLUMN), which
 *    is exactly the thing that legitimately differs between a fresh install and
 *    an upgraded one; nothing in this codebase reads columns positionally.
 *  - Enum sort order is replaced by the label's index, because `ALTER TYPE ...
 *    ADD VALUE BEFORE` produces fractional sort keys that encode insertion
 *    history rather than the resulting label order.
 *  - NOT NULL constraints (contype 'n', PG 18+) are skipped: they carry
 *    generated, OID-derived names and are already covered by is_nullable.
 *  - OIDs are never selected, only `pg_get_*def()` text.
 */
export async function captureSchema<DB>(
	db: Kysely<DB>,
	schema = "public",
): Promise<SchemaSnapshot> {
	const snapshot: SchemaSnapshot = {};

	const columns = await sql<ColumnRow>`
		SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
			c.is_nullable, c.column_default, c.character_maximum_length,
			c.numeric_precision, c.numeric_scale, c.datetime_precision,
			c.is_identity, c.identity_generation, c.is_generated,
			c.generation_expression, c.collation_name
		FROM information_schema.columns c
		JOIN information_schema.tables t
			ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_schema = ${schema} AND t.table_type = 'BASE TABLE'
	`.execute(db);
	const tables = new Set<string>();
	for (const r of columns.rows) {
		if (IGNORED_TABLES.has(r.table_name)) continue;
		tables.add(r.table_name);
		snapshot[`column ${r.table_name}.${r.column_name}`] = descriptor({
			type: r.data_type,
			udt: r.udt_name,
			nullable: r.is_nullable,
			default: r.column_default,
			maxlen: r.character_maximum_length,
			precision: r.numeric_precision,
			scale: r.numeric_scale,
			datetime_precision: r.datetime_precision,
			identity: r.is_identity,
			identity_generation: r.identity_generation,
			generated: r.is_generated,
			generation: r.generation_expression,
			collation: r.collation_name,
		});
	}
	// A table with zero columns is impossible, but recording table existence
	// separately keeps "table missing entirely" a single diff line instead of one
	// per column.
	for (const t of tables) snapshot[`table ${t}`] = "present";

	const indexes = await sql<IndexRow>`
		SELECT tablename, indexname, indexdef
		FROM pg_indexes
		WHERE schemaname = ${schema}
	`.execute(db);
	for (const r of indexes.rows) {
		if (IGNORED_TABLES.has(r.tablename)) continue;
		snapshot[`index ${r.tablename}.${r.indexname}`] = r.indexdef;
	}

	const constraints = await sql<ConstraintRow>`
		SELECT rel.relname AS table_name, con.conname, con.contype,
			pg_get_constraintdef(con.oid) AS def
		FROM pg_constraint con
		JOIN pg_class rel ON rel.oid = con.conrelid
		JOIN pg_namespace ns ON ns.oid = rel.relnamespace
		WHERE ns.nspname = ${schema} AND con.contype <> 'n'
	`.execute(db);
	for (const r of constraints.rows) {
		if (IGNORED_TABLES.has(r.table_name)) continue;
		snapshot[`constraint ${r.table_name}.${r.conname}`] = descriptor({
			type: r.contype,
			def: r.def,
		});
	}

	const enums = await sql<EnumRow>`
		SELECT t.typname, e.enumlabel
		FROM pg_type t
		JOIN pg_enum e ON e.enumtypid = t.oid
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE n.nspname = ${schema}
		ORDER BY t.typname, e.enumsortorder
	`.execute(db);
	const enumLabels = new Map<string, string[]>();
	for (const r of enums.rows) {
		const labels = enumLabels.get(r.typname) ?? [];
		labels.push(r.enumlabel);
		enumLabels.set(r.typname, labels);
	}
	for (const [name, labels] of enumLabels) {
		snapshot[`enum ${name}`] = labels
			.map((label, i) => `${i}:${label}`)
			.join(",");
	}

	const views = await sql<ViewRow>`
		SELECT viewname AS table_name, definition AS view_definition, 'view' AS kind
		FROM pg_views WHERE schemaname = ${schema}
		UNION ALL
		SELECT matviewname, definition, 'matview'
		FROM pg_matviews WHERE schemaname = ${schema}
	`.execute(db);
	for (const r of views.rows) {
		snapshot[`${r.kind} ${r.table_name}`] = (r.view_definition ?? "").trim();
	}

	const sequences = await sql<SequenceRow>`
		SELECT sequence_name, data_type, start_value, increment,
			minimum_value, maximum_value, cycle_option
		FROM information_schema.sequences
		WHERE sequence_schema = ${schema}
	`.execute(db);
	for (const r of sequences.rows) {
		// last_value is data, not shape — deliberately not read.
		snapshot[`sequence ${r.sequence_name}`] = descriptor({
			type: r.data_type,
			start: r.start_value,
			increment: r.increment,
			min: r.minimum_value,
			max: r.maximum_value,
			cycle: r.cycle_option,
		});
	}

	// Installed extensions are recorded by name+version rather than by expanding
	// the hundreds of functions and operators they own: a fresh install picking up
	// a newer extension version than an upgraded database is a real divergence and
	// is caught here, without drowning the diff in pg_trgm internals.
	const extensions = await sql<{ extname: string; extversion: string }>`
		SELECT extname, extversion FROM pg_extension
	`.execute(db);
	for (const r of extensions.rows) {
		snapshot[`extension ${r.extname}`] = r.extversion;
	}

	const routines = await sql<RoutineRow>`
		SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
		FROM pg_proc p
		JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = ${schema} AND p.prokind IN ('f', 'p')
			AND NOT EXISTS (
				SELECT 1 FROM pg_depend d
				WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
					AND d.deptype = 'e'
			)
	`.execute(db);
	for (const r of routines.rows) {
		snapshot[`routine ${r.name}`] = r.def;
	}

	const triggers = await sql<TriggerRow>`
		SELECT rel.relname, tg.tgname, pg_get_triggerdef(tg.oid) AS def
		FROM pg_trigger tg
		JOIN pg_class rel ON rel.oid = tg.tgrelid
		JOIN pg_namespace ns ON ns.oid = rel.relnamespace
		WHERE ns.nspname = ${schema} AND NOT tg.tgisinternal
	`.execute(db);
	for (const r of triggers.rows) {
		if (IGNORED_TABLES.has(r.relname)) continue;
		snapshot[`trigger ${r.relname}.${r.tgname}`] = r.def;
	}

	return snapshot;
}

/** Stable hash of a snapshot — cheap identity for "these schemas are the same". */
export function schemaDigest(snapshot: SchemaSnapshot): string {
	const hash = createHash("sha256");
	for (const key of Object.keys(snapshot).sort()) {
		hash.update(`${key} ${snapshot[key]} `);
	}
	return hash.digest("hex");
}

/** Every object that exists in only one snapshot, or differs between the two. */
export function diffSchemas(
	a: SchemaSnapshot,
	b: SchemaSnapshot,
): SchemaDiffEntry[] {
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
	const out: SchemaDiffEntry[] = [];
	for (const key of keys) {
		if (a[key] === b[key]) continue;
		out.push({ key, a: a[key], b: b[key] });
	}
	return out;
}

/** One line per diverged object, sized to be readable in a test failure. */
export function formatSchemaDiff(diff: SchemaDiffEntry[]): string {
	return diff
		.map(({ key, a, b }) => {
			if (a === undefined) return `+ ${key}\n    only in upgraded: ${b}`;
			if (b === undefined) return `- ${key}\n    only in fresh: ${a}`;
			return `~ ${key}\n    fresh:    ${a}\n    upgraded: ${b}`;
		})
		.join("\n");
}
