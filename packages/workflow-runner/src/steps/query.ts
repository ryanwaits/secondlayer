import type { Database } from "@secondlayer/shared/db";
import type { QueryOptions } from "@secondlayer/workflows";
import { type Kysely, type RawBuilder, sql } from "kysely";

const MAX_ROWS = 1000;
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const SQL_OPS: Record<string, string> = {
	eq: "=",
	neq: "!=",
	gt: ">",
	gte: ">=",
	lt: "<",
	lte: "<=",
};

function assertIdentifier(name: string, label: string): void {
	if (!IDENTIFIER_RE.test(name)) {
		throw new Error(
			`Invalid ${label}: "${name}" — must be alphanumeric/underscore only`,
		);
	}
}

/** Look up the PG schema name for a subgraph. */
async function resolveSchemaName(
	db: Kysely<Database>,
	subgraphName: string,
): Promise<string> {
	const row = await db
		.selectFrom("subgraphs")
		.select("schema_name")
		.where("name", "=", subgraphName)
		.where("status", "!=", "deleted")
		.executeTakeFirst();

	if (!row?.schema_name) {
		throw new Error(`Subgraph "${subgraphName}" not found or has no schema`);
	}

	return row.schema_name;
}

/** Build a parameterized WHERE clause from a filter object. */
function buildWhereClause(
	where: Record<string, unknown> | undefined,
): RawBuilder<unknown> {
	if (!where) return sql``;

	const conditions: RawBuilder<unknown>[] = [];

	for (const [key, value] of Object.entries(where)) {
		assertIdentifier(key, "column name");
		const col = sql.ref(key);

		if (value != null && typeof value === "object" && !Array.isArray(value)) {
			for (const [op, opVal] of Object.entries(
				value as Record<string, unknown>,
			)) {
				const sqlOp = SQL_OPS[op];
				if (sqlOp) {
					conditions.push(sql`${col} ${sql.raw(sqlOp)} ${opVal}`);
				}
			}
		} else {
			conditions.push(sql`${col} = ${value}`);
		}
	}

	if (conditions.length === 0) return sql``;
	return sql`WHERE ${sql.join(conditions, sql` AND `)}`;
}

/** Query a subgraph table with parameterized filters. */
export async function executeQueryStep(
	db: Kysely<Database>,
	subgraph: string,
	table: string,
	options?: QueryOptions,
): Promise<Record<string, unknown>[]> {
	assertIdentifier(table, "table name");
	const schema = await resolveSchemaName(db, subgraph);
	const limit = Math.min(options?.limit ?? 100, MAX_ROWS);
	const offset = options?.offset ?? 0;

	const whereClause = buildWhereClause(options?.where);

	let orderClause: RawBuilder<unknown> = sql``;
	if (options?.orderBy) {
		const parts = Object.entries(options.orderBy).map(([col, dir]) => {
			assertIdentifier(col, "orderBy column");
			const direction = dir === "desc" ? sql.raw("DESC") : sql.raw("ASC");
			return sql`${sql.ref(col)} ${direction}`;
		});
		orderClause = sql`ORDER BY ${sql.join(parts, sql`, `)}`;
	}

	const tableRef = sql.table(`${schema}.${table}`);
	const result = await sql<
		Record<string, unknown>
	>`SELECT * FROM ${tableRef} ${whereClause} ${orderClause} LIMIT ${sql.lit(limit)} OFFSET ${sql.lit(offset)}`.execute(
		db,
	);

	return (result.rows ?? []) as Record<string, unknown>[];
}

/** Count rows in a subgraph table. */
export async function executeCountStep(
	db: Kysely<Database>,
	subgraph: string,
	table: string,
	where?: Record<string, unknown>,
): Promise<number> {
	assertIdentifier(table, "table name");
	const schema = await resolveSchemaName(db, subgraph);

	const whereClause = buildWhereClause(where);
	const tableRef = sql.table(`${schema}.${table}`);

	const result = await sql<{
		count: number;
	}>`SELECT COUNT(*)::int as count FROM ${tableRef} ${whereClause}`.execute(db);

	return result.rows?.[0]?.count ?? 0;
}
