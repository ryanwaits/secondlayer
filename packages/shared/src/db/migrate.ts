import { Kysely, Migrator, FileMigrationProvider } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { promises as fs } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { Database } from "./types.ts";

const migrationsFolder = resolve(dirname(import.meta.dir), "../migrations");

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL environment variable is required");
    process.exit(1);
  }

  console.log("🔄 Running migrations...");

  const client = postgres(connectionString, { max: 1 });
  const db = new Kysely<Database>({
    dialect: new PostgresJSDialect({ postgres: client }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path: { join },
      migrationFolder: migrationsFolder,
    }),
  });

  try {
    const { error, results } = await migrator.migrateToLatest();
    results?.forEach((r) => {
      if (r.status === "Success") console.log(`✅ ${r.migrationName}`);
      else if (r.status === "Error") console.error(`❌ ${r.migrationName}`);
    });
    if (error) throw error;
    console.log("✅ Migrations completed successfully");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

runMigrations();
