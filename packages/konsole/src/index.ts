#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "kysely";
import { connectDb } from "./db.ts";
import { createModelsFromSchema } from "./model/factory.ts";
import { bold, dim, red } from "./repl/colors.ts";
import { startRepl } from "./repl/repl.ts";
import { inferAssociations } from "./schema/associations.ts";
import { introspectSchema } from "./schema/introspect.ts";

// Load .env files — docker/.env first, root .env can override
for (const rel of ["docker/.env", ".env"]) {
	const envPath = resolve(import.meta.dir, "../../..", rel);
	if (existsSync(envPath)) {
		const text = await Bun.file(envPath).text();
		for (const line of text.split("\n")) {
			const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
			if (match && !process.env[match[1]]) {
				process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
			}
		}
	}
}

// Parse URL from argv or env
const url = process.argv[2] || process.env.DATABASE_URL;
if (!url) {
	console.error(red("Usage: konsole <postgres://...> or set DATABASE_URL"));
	process.exit(1);
}

const { db, close } = connectDb(url);

try {
	await sql`SELECT 1`.execute(db);
} catch (e) {
	const msg = e instanceof Error ? e.message : String(e);
	console.error(red(`Failed to connect: ${msg}`));
	process.exit(1);
}

const schema = await introspectSchema(db);
const associations = inferAssociations(schema);
const models = createModelsFromSchema(db, schema, associations);

// Banner
const host = url.match(/@([^:/]+)/)?.[1] || "localhost";
const dbName = url.match(/\/([^/?]+)(\?|$)/)?.[1] || "unknown";
const modelNames = Object.keys(models);
const relCount = Object.values(associations).reduce((n, a) => n + a.length, 0);

console.log("");
console.log(bold("  konsole"));
console.log(dim(`  ${host}/${dbName}`));
console.log(dim(`  ${schema.tables.size} tables, ${relCount} relations`));
console.log("");
console.log(dim("  Models: ") + modelNames.join(", "));
console.log(dim("  Type .help for commands, .exit to quit"));
console.log("");

startRepl({ db, schema, associations, models, close });
