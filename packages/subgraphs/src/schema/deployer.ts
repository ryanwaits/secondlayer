import type { Database } from "@secondlayer/shared/db";
import type { ByoBreakingChangeDetails } from "@secondlayer/shared/errors";
import { type Kysely, sql } from "kysely";
import type {
	SubgraphDefinition,
	SubgraphSchema,
	SubgraphTable,
} from "../types.ts";
import { validateSubgraphDefinition } from "../validate.ts";
import {
	TYPE_MAP,
	emitForeignKeyDDL,
	emitTableDDL,
	generateSubgraphSQL,
	tableNeedsTrgm,
} from "./generator.ts";
import { pgSchemaName } from "./utils.ts";

type AnyDb = Kysely<Database>;

/** Deep-clone an object, converting BigInts to strings for JSON serialization. */
function toJsonSafe(obj: unknown): unknown {
	return JSON.parse(
		JSON.stringify(obj, (_key, value) =>
			typeof value === "bigint" ? value.toString() : value,
		),
	);
}

export interface TableDiff {
	/** Tables added to the schema */
	addedTables: string[];
	/** Tables removed from the schema */
	removedTables: string[];
	/** Per-table column diffs (only for tables present in both) */
	tables: Record<string, ColumnDiff>;
	/** Per-table uniqueKeys / composite-index diffs (tables present in both) */
	constraints: Record<string, ConstraintDiff>;
}

export interface ColumnDiff {
	added: string[];
	removed: string[];
	/** Data-shape changes (type/nullable/default) — breaking. */
	changed: string[];
	/** Only the `indexed`/`search` flags differ — index DDL, never a rebuild. */
	indexChanged: string[];
}

export interface ConstraintDiff {
	/** New uniqueKeys entries → `ALTER TABLE … ADD CONSTRAINT` (additive). */
	addedUniqueKeys: string[][];
	/** Removed uniqueKeys entries — breaking: handler upserts may target them. */
	removedUniqueKeys: string[][];
	/** New composite `indexes` entries → CREATE INDEX (additive). */
	addedIndexes: string[][];
	/** Removed composite `indexes` entries → DROP INDEX (additive). */
	removedIndexes: string[][];
}

/** Column identity minus the index flags: what actually shapes stored data. */
function columnDataShape(col: unknown): string {
	const { indexed, search, ...rest } = (col ?? {}) as Record<string, unknown>;
	return JSON.stringify(rest, Object.keys(rest).sort());
}

/** Diff two `string[][]` lists (uniqueKeys / indexes) by column-list value. */
function diffKeyLists(
	existing: string[][] | undefined,
	incoming: string[][] | undefined,
): { added: string[][]; removed: string[][] } {
	const key = (cols: string[]) => JSON.stringify(cols);
	const existingSet = new Set((existing ?? []).map(key));
	const incomingSet = new Set((incoming ?? []).map(key));
	return {
		added: (incoming ?? []).filter((cols) => !existingSet.has(key(cols))),
		removed: (existing ?? []).filter((cols) => !incomingSet.has(key(cols))),
	};
}

/**
 * Compare two multi-table subgraph schemas and return differences.
 *
 * Index-only changes (`indexed`/`search` flags, composite `indexes`) are
 * reported separately from data-shape changes: an index never requires a
 * rebuild, so it must never land in `changed`/breaking — flipping
 * `indexed: true` on a populated column used to cost a full reindex.
 */
export function diffSchema(
	existing: SubgraphSchema,
	incoming: SubgraphSchema,
): TableDiff {
	const existingTables = new Set(Object.keys(existing));
	const incomingTables = new Set(Object.keys(incoming));

	const addedTables = [...incomingTables].filter((t) => !existingTables.has(t));
	const removedTables = [...existingTables].filter(
		(t) => !incomingTables.has(t),
	);

	const tables: Record<string, ColumnDiff> = {};
	const constraints: Record<string, ConstraintDiff> = {};
	for (const tableName of incomingTables) {
		if (!existingTables.has(tableName)) continue;
		const existingTable = existing[tableName];
		const incomingTable = incoming[tableName];
		const existingCols = existingTable?.columns;
		const incomingCols = incomingTable?.columns;

		const existingKeys = new Set(Object.keys(existingCols));
		const incomingKeys = new Set(Object.keys(incomingCols));
		const common = [...incomingKeys].filter((k) => existingKeys.has(k));

		const sortedStringify = (o: unknown) =>
			JSON.stringify(o, Object.keys(o as object).sort());

		tables[tableName] = {
			added: [...incomingKeys].filter((k) => !existingKeys.has(k)),
			removed: [...existingKeys].filter((k) => !incomingKeys.has(k)),
			changed: common.filter(
				(k) =>
					columnDataShape(existingCols[k]) !== columnDataShape(incomingCols[k]),
			),
			indexChanged: common.filter(
				(k) =>
					columnDataShape(existingCols[k]) ===
						columnDataShape(incomingCols[k]) &&
					sortedStringify(existingCols[k]) !== sortedStringify(incomingCols[k]),
			),
		};

		const uq = diffKeyLists(
			existingTable?.uniqueKeys,
			incomingTable?.uniqueKeys,
		);
		const ix = diffKeyLists(existingTable?.indexes, incomingTable?.indexes);
		constraints[tableName] = {
			addedUniqueKeys: uq.added,
			removedUniqueKeys: uq.removed,
			addedIndexes: ix.added,
			removedIndexes: ix.removed,
		};
	}

	return { addedTables, removedTables, tables, constraints };
}

/**
 * Returns true if the diff contains any breaking changes
 * (removed tables, removed columns, changed column types, or removed
 * uniqueKeys — handler upserts `ON CONFLICT` against those).
 * Index-flag and composite-index changes are never breaking.
 */
export function hasBreakingChanges(diff: TableDiff): {
	breaking: boolean;
	reasons: string[];
} {
	const reasons: string[] = [];
	if (diff.removedTables.length > 0) {
		reasons.push(`removed tables: [${diff.removedTables.join(", ")}]`);
	}
	for (const [table, colDiff] of Object.entries(diff.tables)) {
		if (colDiff.removed.length > 0) {
			reasons.push(`${table}: removed columns [${colDiff.removed.join(", ")}]`);
		}
		if (colDiff.changed.length > 0) {
			reasons.push(`${table}: changed columns [${colDiff.changed.join(", ")}]`);
		}
	}
	for (const [table, conDiff] of Object.entries(diff.constraints ?? {})) {
		if (conDiff.removedUniqueKeys.length > 0) {
			reasons.push(
				`${table}: removed uniqueKeys [${conDiff.removedUniqueKeys
					.map((cols) => `(${cols.join(", ")})`)
					.join(", ")}]`,
			);
		}
	}
	return { breaking: reasons.length > 0, reasons };
}

/** Increment the patch segment of a semver string. "1.0.2" → "1.0.3" */
function bumpPatch(version: string): string {
	const parts = version.split(".");
	if (parts.length !== 3) return "1.0.1";
	const patch = Number.parseInt(parts[2] ?? "0", 10);
	return `${parts[0]}.${parts[1]}.${Number.isNaN(patch) ? 1 : patch + 1}`;
}

export interface DeployDiff {
	addedTables: string[];
	removedTables: string[];
	addedColumns: Record<string, string[]>;
	breakingChanges: string[];
	/** Columns whose only change was the `indexed`/`search` flag (index DDL applied in place). */
	indexChanges?: Record<string, string[]>;
	/** uniqueKeys added in place via ALTER TABLE … ADD CONSTRAINT. */
	addedUniqueKeys?: Record<string, string[][]>;
}

export interface ByoMigrationPlan {
	schemaName: string;
	dropStatement: string;
	statements: string[];
	grantScript: string;
}

/**
 * Thrown when a BYO subgraph deploy is refused for a breaking schema change.
 * Plain `Error` with a literal `code` (not `SecondLayerError`) so the API
 * middleware matches it by code across bundle boundaries — bunup duplicates
 * classes per package, breaking cross-bundle `instanceof`. The refusal stands;
 * `details` carries the reviewable DROP + rebuild the user must run manually.
 */
export class ByoBreakingChangeError extends Error {
	readonly code = "BYO_BREAKING_CHANGE" as const;
	readonly details: ByoBreakingChangeDetails;

	constructor(reasons: string[], diff: DeployDiff, plan: ByoMigrationPlan) {
		super(
			"Breaking schema change on a BYO subgraph would drop data in your " +
				"database. Review the plan and run the DROP + rebuild DDL manually.",
		);
		this.name = "ByoBreakingChangeError";
		this.details = { reasons, diff, plan };
	}
}

/**
 * Map a raw `TableDiff` (+ breaking reasons) into the wire `DeployDiff`. `null`
 * diff (e.g. same-hash force reindex, where no schema diff exists) → empty
 * added/removed/columns with reasons preserved. Single source for both the
 * non-refuse "reindexed" result and the refuse-path error payload.
 */
function toDeployDiff(diff: TableDiff | null, reasons: string[]): DeployDiff {
	return {
		addedTables: diff?.addedTables ?? [],
		removedTables: diff?.removedTables ?? [],
		addedColumns: diff
			? Object.fromEntries(
					Object.entries(diff.tables)
						.filter(([, c]) => c.added.length > 0)
						.map(([t, c]) => [t, c.added]),
				)
			: {},
		breakingChanges: reasons,
	};
}

export interface DeployPlan {
	schemaName: string;
	/** `DROP SCHEMA … CASCADE` a destructive rebuild would run first (shown, never auto-run on BYO). */
	dropStatement: string;
	/** DDL Secondlayer will run against your database. */
	statements: string[];
	/** Least-privilege grant script to run once, before deploying. */
	grantScript: string;
}

/**
 * Render the DDL + grant script a BYO deploy would run, without executing.
 * Powers `--dry-run`: the user reviews exactly what touches their DB first.
 */
export function renderDeployPlan(
	def: SubgraphDefinition,
	schemaName?: string,
): DeployPlan {
	validateSubgraphDefinition(def);
	const { statements } = generateSubgraphSQL(def, schemaName);
	const schema = schemaName ?? pgSchemaName(def.name);
	const dropStatement = `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`;
	const grantScript = [
		"-- Run once on YOUR database as an owner/superuser, replacing <role>",
		"-- with the role whose credentials you give Secondlayer.",
		"-- Secondlayer then creates and owns only this one schema:",
		"GRANT CREATE ON DATABASE current_database() TO <role>;",
		`-- (after first deploy <role> owns "${schema}"; no further grants needed)`,
	].join("\n");
	return { schemaName: schema, dropStatement, statements, grantScript };
}

/**
 * Deploy a subgraph schema to the database.
 * - New subgraph → CREATE SCHEMA + tables + register
 * - Same hash → no-op (handler path updated)
 * - Additive change → ALTER TABLE ADD COLUMN / CREATE TABLE for new tables
 * - Breaking change → auto-reindex (drop + recreate)
 */
export async function deploySchema(
	db: AnyDb,
	def: SubgraphDefinition,
	handlerPath: string,
	opts?: {
		forceReindex?: boolean;
		apiKeyId?: string;
		accountId?: string;
		schemaName?: string;
		version?: string;
		handlerCode?: string;
		sourceCode?: string;
		/**
		 * BYO data plane: when set, schema DDL (CREATE/ALTER/index) runs against
		 * the user-owned DB while the subgraphs registry row stays on `db`
		 * (managed). Defaults to `db` — managed deploys are unchanged.
		 */
		dataDb?: AnyDb;
		/** Encrypted user-DB connection string to persist on the registry row. */
		databaseUrlEnc?: Buffer | null;
	},
): Promise<{
	action: "created" | "unchanged" | "handler_updated" | "updated" | "reindexed";
	subgraphId: string;
	version: string;
	diff?: DeployDiff;
	/** Non-fatal caveats the caller should surface (e.g. handler grafts at tip). */
	warnings?: string[];
}> {
	validateSubgraphDefinition(def);

	const { statements, hash } = generateSubgraphSQL(def, opts?.schemaName);
	const { getSubgraph, registerSubgraph } = await import(
		"@secondlayer/shared/db/queries/subgraphs"
	);

	// DDL target: the user's DB for BYO, else the managed DB. The registry
	// (getSubgraph/registerSubgraph) always stays on `db`.
	const ddlDb = opts?.dataDb ?? db;
	const byo = opts?.dataDb != null;
	const refuseDestructiveOnByo = (
		reasons: string[],
		diff: TableDiff | null,
	): never => {
		const plan = renderDeployPlan(def, opts?.schemaName);
		throw new ByoBreakingChangeError(reasons, toDeployDiff(diff, reasons), {
			schemaName: plan.schemaName,
			dropStatement: plan.dropStatement,
			statements: plan.statements,
			grantScript: plan.grantScript,
		});
	};

	const existing = await getSubgraph(db, def.name, opts?.accountId);

	const schemaName = opts?.schemaName ?? pgSchemaName(def.name);

	// Server owns versioning: use explicit flag, bump patch from existing, or start at 1.0.0
	const newVersion =
		opts?.version ?? (existing ? bumpPatch(existing.version) : "1.0.0");

	const regData = {
		name: def.name,
		version: newVersion,
		definition: toJsonSafe({
			name: def.name,
			version: def.version,
			description: def.description,
			startBlock: def.startBlock,
			sources: def.sources,
			schema: def.schema,
		}) as Record<string, unknown>,
		schemaHash: hash,
		handlerPath,
		apiKeyId: opts?.apiKeyId,
		accountId: opts?.accountId,
		handlerCode: opts?.handlerCode,
		sourceCode: opts?.sourceCode,
		schemaName,
		startBlock: def.startBlock,
		databaseUrlEnc: opts?.databaseUrlEnc ?? null,
	};

	if (existing) {
		// Guard against zombie rows: registry entry exists but PG schema was dropped
		// (e.g. partial delete or manual cleanup). Treat as a new subgraph. The
		// schema lives on the data-plane DB (user DB for BYO), so check there.
		const schemaExists = await sql<{ exists: boolean }>`
			SELECT EXISTS (
				SELECT 1 FROM information_schema.schemata
				WHERE schema_name = ${schemaName}
			) AS "exists"
		`
			.execute(ddlDb)
			.then((r) => r.rows[0]?.exists ?? false);

		if (!schemaExists) {
			for (const stmt of statements) {
				await sql.raw(stmt).execute(ddlDb);
			}
			const sg = await registerSubgraph(db, regData);
			return { action: "reindexed", subgraphId: sg.id, version: newVersion };
		}

		if (existing.schema_hash === hash && !opts?.forceReindex) {
			// Update handler path and code in case file moved or handler changed.
			const handlerChanged =
				opts?.handlerCode != null && opts.handlerCode !== existing.handler_code;
			const { updateSubgraphHandlerPath } = await import(
				"@secondlayer/shared/db/queries/subgraphs"
			);
			await updateSubgraphHandlerPath(db, def.name, handlerPath, {
				handlerCode: opts?.handlerCode,
				sourceCode: opts?.sourceCode,
			});
			return {
				action: handlerChanged ? "handler_updated" : "unchanged",
				subgraphId: existing.id,
				version: existing.version,
				// A handler-only change takes effect from the CURRENT tip: rows
				// already indexed keep the old handler's output. Silent until now —
				// say it, and name the fix.
				...(handlerChanged
					? {
							warnings: [
								"handler changed but schema did not: new logic applies from the current tip only. " +
									"Rows already indexed were computed by the previous handler. " +
									"To recompute history, redeploy with --reindex (or backfill a range).",
							],
						}
					: {}),
			};
		}

		if (existing.schema_hash === hash && opts?.forceReindex) {
			// Same schema but force reindex requested — drop and recreate.
			if (byo) refuseDestructiveOnByo(["force reindex"], null);
			await sql
				.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
				.execute(ddlDb);
			for (const stmt of statements) {
				await sql.raw(stmt).execute(ddlDb);
			}
			const sg = await registerSubgraph(db, regData);
			return { action: "reindexed", subgraphId: sg.id, version: newVersion };
		}

		if (existing.definition.schema) {
			const diff = diffSchema(
				existing.definition.schema as SubgraphSchema,
				def.schema,
			);
			const { breaking, reasons } = hasBreakingChanges(diff);

			if (breaking || opts?.forceReindex) {
				// Breaking change or forced: drop schema, recreate, register
				if (byo) {
					refuseDestructiveOnByo(
						reasons.length > 0 ? reasons : ["force reindex"],
						diff,
					);
				}
				await sql
					.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
					.execute(ddlDb);
				for (const stmt of statements) {
					await sql.raw(stmt).execute(ddlDb);
				}
				const sg = await registerSubgraph(db, regData);
				const deployDiff = toDeployDiff(diff, reasons);
				return {
					action: "reindexed",
					subgraphId: sg.id,
					version: newVersion,
					diff: deployDiff,
				};
			}

			// Create new tables using the SAME per-table emitter as the full
			// generator, so an additively-created table gets its UNIQUE constraints,
			// composite indexes, column defaults, and FKs — not just the bare columns.
			// (A missing UNIQUE here previously made a handler upsert ON CONFLICT fail
			// at runtime on additively-added tables.)
			const addedDefs = diff.addedTables
				.map((tableName) => ({ tableName, tableDef: def.schema[tableName] }))
				.filter(
					(t): t is { tableName: string; tableDef: SubgraphTable } =>
						t.tableDef !== undefined,
				);

			// pg_trgm must exist before any search-column GIN index on the new tables.
			if (addedDefs.some(({ tableDef }) => tableNeedsTrgm(tableDef))) {
				await sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm").execute(ddlDb);
			}
			for (const { tableName, tableDef } of addedDefs) {
				for (const stmt of emitTableDDL(schemaName, tableName, tableDef)) {
					await sql.raw(stmt).execute(ddlDb);
				}
			}
			// FKs in a second pass so every referenced (new or pre-existing) table
			// exists first.
			for (const { tableName, tableDef } of addedDefs) {
				for (const stmt of emitForeignKeyDDL(schemaName, tableName, tableDef)) {
					await sql.raw(stmt).execute(ddlDb);
				}
			}

			// Add columns to existing tables
			for (const [tableName, colDiff] of Object.entries(diff.tables)) {
				if (colDiff.added.length === 0) continue;
				const qualifiedName = `${schemaName}.${tableName}`;
				const tableDef = def.schema[tableName];
				if (!tableDef) continue;
				for (const colName of colDiff.added) {
					const col = tableDef.columns[colName];
					if (!col) continue;
					const sqlType = TYPE_MAP[col.type];
					if (!sqlType) continue;
					const nullable = col.nullable
						? ""
						: ` NOT NULL DEFAULT ${getDefault(col.type)}`;
					await sql
						.raw(
							`ALTER TABLE ${qualifiedName} ADD COLUMN ${colName} ${sqlType}${nullable}`,
						)
						.execute(ddlDb);
					if (col.indexed) {
						await sql
							.raw(
								`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName} ON ${qualifiedName} (${colName})`,
							)
							.execute(ddlDb);
					}
					if (col.search) {
						await sql
							.raw(
								`CREATE INDEX IF NOT EXISTS idx_${schemaName}_${tableName}_${colName}_trgm ON ${qualifiedName} USING gin (${colName} gin_trgm_ops)`,
							)
							.execute(ddlDb);
					}
				}
			}

			// Index-flag flips on EXISTING (populated) columns: pure index DDL,
			// applied in place. CONCURRENTLY because the table has data and this
			// runs outside a transaction (autocommit per statement) — a plain
			// CREATE INDEX would take a write lock for the whole build.
			const existingSchema = existing.definition.schema as SubgraphSchema;
			const flagFlips: Record<string, string[]> = {};
			const needsTrgmForFlips = Object.entries(diff.tables).some(
				([tableName, colDiff]) =>
					colDiff.indexChanged.some(
						(colName) =>
							def.schema[tableName]?.columns[colName]?.search &&
							!existingSchema[tableName]?.columns[colName]?.search,
					),
			);
			if (needsTrgmForFlips) {
				await sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm").execute(ddlDb);
			}
			for (const [tableName, colDiff] of Object.entries(diff.tables)) {
				if (colDiff.indexChanged.length === 0) continue;
				flagFlips[tableName] = colDiff.indexChanged;
				const qualifiedName = `${schemaName}.${tableName}`;
				for (const colName of colDiff.indexChanged) {
					const was = existingSchema[tableName]?.columns[colName];
					const now = def.schema[tableName]?.columns[colName];
					if (!now) continue;
					const plainIdx = `idx_${schemaName}_${tableName}_${colName}`;
					const trgmIdx = `idx_${schemaName}_${tableName}_${colName}_trgm`;
					if (now.indexed && !was?.indexed) {
						await sql
							.raw(
								`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${plainIdx} ON ${qualifiedName} (${colName})`,
							)
							.execute(ddlDb);
					} else if (!now.indexed && was?.indexed) {
						await sql
							.raw(
								`DROP INDEX CONCURRENTLY IF EXISTS ${schemaName}.${plainIdx}`,
							)
							.execute(ddlDb);
					}
					if (now.search && !was?.search) {
						await sql
							.raw(
								`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${trgmIdx} ON ${qualifiedName} USING gin (${colName} gin_trgm_ops)`,
							)
							.execute(ddlDb);
					} else if (!now.search && was?.search) {
						await sql
							.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${schemaName}.${trgmIdx}`)
							.execute(ddlDb);
					}
				}
			}

			// uniqueKeys additions: ADD CONSTRAINT in place (idempotent via
			// pg_constraint check — Postgres has no ADD CONSTRAINT IF NOT EXISTS).
			// Removals never reach here: hasBreakingChanges classifies them
			// breaking, which lands in the reindex branch above.
			const addedUq: Record<string, string[][]> = {};
			for (const [tableName, conDiff] of Object.entries(diff.constraints)) {
				const qualifiedName = `${schemaName}.${tableName}`;
				for (const cols of conDiff.addedUniqueKeys) {
					const constraintName = `uq_${schemaName}_${tableName}_${cols.join("_")}`;
					const exists = await sql<{ exists: boolean }>`
						SELECT EXISTS (
							SELECT 1 FROM pg_constraint
							WHERE conname = ${constraintName}
						) AS "exists"
					`
						.execute(ddlDb)
						.then((r) => r.rows[0]?.exists ?? false);
					if (!exists) {
						await sql
							.raw(
								`ALTER TABLE ${qualifiedName} ADD CONSTRAINT ${constraintName} UNIQUE (${cols.join(", ")})`,
							)
							.execute(ddlDb);
					}
					addedUq[tableName] = [...(addedUq[tableName] ?? []), cols];
				}
				// Composite indexes: additive both ways. Names are positional in the
				// incoming schema; a reordered (unchanged-value) entry keeps its old
				// positionally-derived name, which is harmless.
				for (const cols of conDiff.addedIndexes) {
					const i = (def.schema[tableName]?.indexes ?? []).findIndex(
						(entry) => JSON.stringify(entry) === JSON.stringify(cols),
					);
					const idxName = `idx_${schemaName}_${tableName}_composite_${i}`;
					await sql
						.raw(
							`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idxName} ON ${qualifiedName} (${cols.join(", ")})`,
						)
						.execute(ddlDb);
				}
				for (const cols of conDiff.removedIndexes) {
					const i = (existingSchema[tableName]?.indexes ?? []).findIndex(
						(entry) => JSON.stringify(entry) === JSON.stringify(cols),
					);
					if (i < 0) continue;
					const idxName = `idx_${schemaName}_${tableName}_composite_${i}`;
					await sql
						.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${schemaName}.${idxName}`)
						.execute(ddlDb);
				}
			}

			const sg = await registerSubgraph(db, regData);
			const addedCols: Record<string, string[]> = {};
			for (const [t, colDiff] of Object.entries(diff.tables)) {
				if ((colDiff as ColumnDiff).added.length > 0)
					addedCols[t] = (colDiff as ColumnDiff).added;
			}
			const deployDiff: DeployDiff = {
				addedTables: diff.addedTables,
				removedTables: [],
				addedColumns: addedCols,
				breakingChanges: [],
				...(Object.keys(flagFlips).length > 0
					? { indexChanges: flagFlips }
					: {}),
				...(Object.keys(addedUq).length > 0
					? { addedUniqueKeys: addedUq }
					: {}),
			};
			return {
				action: "updated",
				subgraphId: sg.id,
				version: newVersion,
				diff: deployDiff,
			};
		}
	}

	// New subgraph — execute all DDL
	for (const stmt of statements) {
		await sql.raw(stmt).execute(ddlDb);
	}

	const sg = await registerSubgraph(db, regData);
	return { action: "created", subgraphId: sg.id, version: newVersion };
}

function getDefault(type: string): string {
	switch (type) {
		case "text":
		case "principal":
			return "''";
		case "uint":
		case "int":
			return "0";
		case "boolean":
			return "false";
		case "timestamp":
			return "NOW()";
		case "jsonb":
			return "'{}'";
		default:
			return "''";
	}
}
