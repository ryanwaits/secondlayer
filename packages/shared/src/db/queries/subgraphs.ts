import { sql, type Kysely } from "kysely";
import { jsonb } from "../jsonb.ts";
import type { Database, Subgraph } from "../types.ts";

/**
 * Convert a subgraph name to its PostgreSQL schema name.
 * With keyPrefix: "subgraph_{prefix}_{name}" (tenant-isolated)
 * Without keyPrefix: "subgraph_{name}" (backward compat)
 */
export function pgSchemaName(subgraphName: string, keyPrefix?: string): string {
  const safeName = subgraphName.replace(/-/g, "_");
  if (!keyPrefix) {
    return `subgraph_${safeName}`;
  }
  const safePrefix = keyPrefix.replace(/^sk-sl_/, "").replace(/-/g, "_");
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
    schemaName?: string;
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
      api_key_id: data.apiKeyId!,
      schema_name: data.schemaName ?? null,
    })
    .onConflict((oc) =>
      oc.columns(["name", "api_key_id"]).doUpdateSet({
        version: data.version,
        definition: jsonb(data.definition) as any,
        schema_hash: data.schemaHash,
        handler_path: data.handlerPath,
        schema_name: data.schemaName ?? null,
        updated_at: new Date(),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getSubgraph(db: Kysely<Database>, name: string, apiKeyId?: string): Promise<Subgraph | null> {
  let query = db
    .selectFrom("subgraphs")
    .selectAll()
    .where("name", "=", name);

  if (apiKeyId) {
    query = query.where("api_key_id", "=", apiKeyId);
  }

  return (await query.executeTakeFirst()) ?? null;
}

export async function listSubgraphs(db: Kysely<Database>, apiKeyId?: string): Promise<Subgraph[]> {
  let query = db.selectFrom("subgraphs").selectAll();
  if (apiKeyId) {
    query = query.where("api_key_id", "=", apiKeyId);
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
      ...(lastProcessedBlock !== undefined ? { last_processed_block: lastProcessedBlock } : {}),
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

export async function deleteSubgraph(db: Kysely<Database>, name: string, apiKeyId?: string): Promise<Subgraph | null> {
  const subgraph = await getSubgraph(db, name, apiKeyId);
  if (!subgraph) return null;

  // Use stored schema_name if available, otherwise compute
  const schemaName = subgraph.schema_name ?? pgSchemaName(name);

  // Drop the subgraph's schema (CASCADE drops all tables within)
  await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${schemaName}"`)} CASCADE`.execute(db);

  // Remove from registry
  await db.deleteFrom("subgraphs").where("id", "=", subgraph.id).execute();

  return subgraph;
}
