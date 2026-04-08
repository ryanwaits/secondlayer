import { sql, type Kysely } from "kysely";
import type { Database } from "@secondlayer/shared/db";
import type { QueryOptions } from "@secondlayer/workflows";

const MAX_ROWS = 1000;

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

/** Query a subgraph table with parameterized filters. */
export async function executeQueryStep(
	db: Kysely<Database>,
	subgraph: string,
	table: string,
	options?: QueryOptions,
): Promise<Record<string, unknown>[]> {
	const schema = await resolveSchemaName(db, subgraph);
	const limit = Math.min(options?.limit ?? 100, MAX_ROWS);
	const offset = options?.offset ?? 0;

	// Build parameterized WHERE clauses
	const conditions: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (options?.where) {
		for (const [key, value] of Object.entries(options.where)) {
			if (value != null && typeof value === "object" && !Array.isArray(value)) {
				// Comparison operators: { eq, neq, gt, gte, lt, lte }
				const ops = value as Record<string, unknown>;
				for (const [op, opVal] of Object.entries(ops)) {
					const sqlOp =
						op === "eq" ? "=" :
						op === "neq" ? "!=" :
						op === "gt" ? ">" :
						op === "gte" ? ">=" :
						op === "lt" ? "<" :
						op === "lte" ? "<=" : null;
					if (sqlOp) {
						conditions.push(`"${key}" ${sqlOp} $${paramIndex++}`);
						values.push(opVal);
					}
				}
			} else {
				conditions.push(`"${key}" = $${paramIndex++}`);
				values.push(value);
			}
		}
	}

	const whereClause =
		conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	// Build ORDER BY
	let orderClause = "";
	if (options?.orderBy) {
		const parts = Object.entries(options.orderBy).map(
			([col, dir]) => `"${col}" ${dir === "desc" ? "DESC" : "ASC"}`,
		);
		orderClause = `ORDER BY ${parts.join(", ")}`;
	}

	const fullQuery = `SELECT * FROM "${schema}"."${table}" ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;

	const result = await sql.raw(fullQuery).execute(db);

	return (result.rows ?? []) as Record<string, unknown>[];
}

/** Count rows in a subgraph table. */
export async function executeCountStep(
	db: Kysely<Database>,
	subgraph: string,
	table: string,
	where?: Record<string, unknown>,
): Promise<number> {
	const schema = await resolveSchemaName(db, subgraph);

	const conditions: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (where) {
		for (const [key, value] of Object.entries(where)) {
			conditions.push(`"${key}" = $${paramIndex++}`);
			values.push(value);
		}
	}

	const whereClause =
		conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const fullQuery = `SELECT COUNT(*)::int as count FROM "${schema}"."${table}" ${whereClause}`;

	const result = await sql.raw(fullQuery).execute(db);

	return (result.rows as any)?.[0]?.count ?? 0;
}
