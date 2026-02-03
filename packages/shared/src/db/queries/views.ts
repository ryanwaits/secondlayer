import { sql, type Kysely } from "kysely";
import { jsonb } from "../jsonb.ts";
import type { Database } from "../types.ts";

/**
 * Convert a view name to its PostgreSQL schema name.
 * With keyPrefix: "view_{prefix}_{name}" (tenant-isolated)
 * Without keyPrefix: "view_{name}" (backward compat)
 */
export function pgSchemaName(viewName: string, keyPrefix?: string): string {
  const safeName = viewName.replace(/-/g, "_");
  if (!keyPrefix) {
    return `view_${safeName}`;
  }
  const safePrefix = keyPrefix.replace(/^sk-sl_/, "").replace(/-/g, "_");
  return `view_${safePrefix}_${safeName}`;
}

export async function registerView(
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
) {
  return await db
    .insertInto("views")
    .values({
      name: data.name,
      version: data.version,
      definition: jsonb(data.definition) as any,
      schema_hash: data.schemaHash,
      handler_path: data.handlerPath,
      api_key_id: data.apiKeyId ?? null,
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

export async function getView(db: Kysely<Database>, name: string, apiKeyId?: string) {
  let query = db
    .selectFrom("views")
    .selectAll()
    .where("name", "=", name);

  if (apiKeyId) {
    query = query.where("api_key_id", "=", apiKeyId);
  }

  return (await query.executeTakeFirst()) ?? null;
}

export async function listViews(db: Kysely<Database>, apiKeyId?: string) {
  let query = db.selectFrom("views").selectAll();
  if (apiKeyId) {
    query = query.where("api_key_id", "=", apiKeyId);
  }
  return query.execute();
}

export async function updateViewStatus(
  db: Kysely<Database>,
  name: string,
  status: string,
  lastProcessedBlock?: number,
) {
  await db
    .updateTable("views")
    .set({
      status,
      ...(lastProcessedBlock !== undefined ? { last_processed_block: lastProcessedBlock } : {}),
      updated_at: new Date(),
    })
    .where("name", "=", name)
    .execute();
}

export async function recordViewProcessed(
  db: Kysely<Database>,
  name: string,
  processed: number,
  errors: number,
  lastError?: string,
) {
  await db
    .updateTable("views")
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

export async function updateViewHandlerPath(
  db: Kysely<Database>,
  name: string,
  handlerPath: string,
) {
  await db
    .updateTable("views")
    .set({ handler_path: handlerPath, updated_at: new Date() })
    .where("name", "=", name)
    .execute();
}

export async function deleteView(db: Kysely<Database>, name: string, apiKeyId?: string) {
  const view = await getView(db, name, apiKeyId);
  if (!view) return null;

  // Use stored schema_name if available, otherwise compute
  const schemaName = view.schema_name ?? pgSchemaName(name);

  // Drop the view's schema (CASCADE drops all tables within)
  await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${schemaName}"`)} CASCADE`.execute(db);

  // Remove from registry
  await db.deleteFrom("views").where("id", "=", view.id).execute();

  return view;
}
