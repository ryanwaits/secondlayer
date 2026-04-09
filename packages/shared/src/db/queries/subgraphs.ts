import { type Kysely, sql } from "kysely";
import { jsonb } from "../jsonb.ts";
import type { Database, Subgraph } from "../types.ts";

/**
 * Convert a subgraph name to its PostgreSQL schema name.
 * With accountPrefix (first 8 chars of account_id): "subgraph_{prefix}_{name}"
 * Without prefix: "subgraph_{name}" (backward compat / local dev)
 */
export function pgSchemaName(
	subgraphName: string,
	accountPrefix?: string,
): string {
	const safeName = subgraphName.replace(/-/g, "_");
	if (!accountPrefix) {
		return `subgraph_${safeName}`;
	}
	const safePrefix = accountPrefix.replace(/-/g, "_");
	return `subgraph_${safePrefix}_${safeName}`;
}

export async function registerSubgraph(
	db: Kysely<Database>,
	data: {
		name: string;
		version: string;
		definition: Record<string, unknown>;
		schemaHash: string;
		handlerPath: string;
		apiKeyId?: string;
		accountId?: string;
		schemaName?: string;
		startBlock?: number;
		forkedFromId?: string;
		handlerCode?: string;
	},
): Promise<Subgraph> {
	return await db
		.insertInto("subgraphs")
		.values({
			name: data.name,
			version: data.version,
			definition: jsonb(data.definition) as any,
			schema_hash: data.schemaHash,
			handler_path: data.handlerPath,
			api_key_id: data.apiKeyId ?? null,
			account_id: data.accountId ?? "",
			handler_code: data.handlerCode ?? null,
			schema_name: data.schemaName ?? null,
			start_block: data.startBlock ?? 0,
			forked_from_id: data.forkedFromId ?? null,
		})
		.onConflict((oc) =>
			oc.columns(["name", "account_id"]).doUpdateSet({
				version: data.version,
				definition: jsonb(data.definition) as any,
				schema_hash: data.schemaHash,
				handler_path: data.handlerPath,
				handler_code: data.handlerCode ?? null,
				api_key_id: data.apiKeyId ?? null,
				schema_name: data.schemaName ?? null,
				start_block: data.startBlock ?? 0,
				updated_at: new Date(),
			}),
		)
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function getSubgraph(
	db: Kysely<Database>,
	name: string,
	accountId?: string,
): Promise<Subgraph | null> {
	let query = db.selectFrom("subgraphs").selectAll().where("name", "=", name);

	if (accountId) {
		query = query.where("account_id", "=", accountId);
	}

	return (await query.executeTakeFirst()) ?? null;
}

export async function listSubgraphs(
	db: Kysely<Database>,
	accountId?: string,
): Promise<Subgraph[]> {
	let query = db.selectFrom("subgraphs").selectAll();
	if (accountId) {
		query = query.where("account_id", "=", accountId);
	}
	return query.execute();
}

export async function updateSubgraphStatus(
	db: Kysely<Database>,
	name: string,
	status: string,
	lastProcessedBlock?: number,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			status,
			...(lastProcessedBlock !== undefined
				? { last_processed_block: lastProcessedBlock }
				: {}),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.execute();
}

export async function recordSubgraphProcessed(
	db: Kysely<Database>,
	name: string,
	processed: number,
	errors: number,
	lastError?: string,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			total_processed: sql`total_processed + ${processed}`,
			total_errors: sql`total_errors + ${errors}`,
			...(lastError
				? { last_error: lastError, last_error_at: new Date() }
				: {}),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.execute();
}

export async function updateSubgraphHandlerPath(
	db: Kysely<Database>,
	name: string,
	handlerPath: string,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({ handler_path: handlerPath, updated_at: new Date() })
		.where("name", "=", name)
		.execute();
}

export async function deleteSubgraph(
	db: Kysely<Database>,
	name: string,
	accountId?: string,
): Promise<Subgraph | null> {
	const subgraph = await getSubgraph(db, name, accountId);
	if (!subgraph) return null;

	// Use stored schema_name if available, otherwise compute
	const schemaName = subgraph.schema_name ?? pgSchemaName(name);

	// Drop the subgraph's schema (CASCADE drops all tables within)
	await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${schemaName}"`)} CASCADE`.execute(
		db,
	);

	// Remove from registry
	await db.deleteFrom("subgraphs").where("id", "=", subgraph.id).execute();

	return subgraph;
}
