#!/usr/bin/env bun
/**
 * Migrate an existing single-DB account's subgraph data into a fresh
 * per-tenant dedicated instance.
 *
 * Run on the Hetzner app server with access to both source DB admin creds
 * AND the Docker socket (provisioner runs locally — we reuse its provision
 * machinery, then shell out to pg_dump/pg_restore via docker exec on the
 * running postgres containers).
 *
 * Usage:
 *   bun run packages/provisioner/src/migrate-tenant.ts \
 *     --account-id <uuid> \
 *     --plan launch \
 *     [--dry-run] \
 *     [--keep-source-schemas]
 *
 * Flow (all-or-nothing — script exits non-zero on any step failure):
 *   1. Discover: list subgraphs owned by the account
 *   2. Preflight: verify schemas exist in source, handler files exist on disk
 *   3. Provision tenant (or reuse if already provisioned)
 *   4. For each subgraph schema: pg_dump from source → pg_restore to tenant
 *   5. Rename schemas in tenant (drop `_<prefix>` — single-tenant now)
 *   6. Insert subgraph registry rows into tenant DB
 *   7. Copy handler .js files from source volume to tenant api + processor
 *   8. Verify: row counts match source vs tenant
 *   9. Print next steps
 *
 * Source schemas are LEFT IN PLACE by default (30-day safety window). Drop
 * manually once the tenant's been running cleanly for a while.
 */

import { existsSync } from "node:fs";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	getTenantByAccount,
	getTenantCredentials,
	insertTenant,
} from "@secondlayer/shared/db/queries/tenants";
import postgres from "postgres";
import { getConfig } from "./config.ts";
import { mintTenantKeys } from "./jwt.ts";
import { type PlanId, getPlan } from "./plans.ts";
import { provisionTenant } from "./provision.ts";

// ── Argv parsing ───────────────────────────────────────────────────────

interface Args {
	accountId: string;
	plan: PlanId;
	dryRun: boolean;
	keepSourceSchemas: boolean;
}

function parseArgs(): Args {
	const argv = process.argv.slice(2);
	let accountId: string | undefined;
	let plan: string | undefined;
	let dryRun = false;
	let keepSourceSchemas = true; // default: don't drop source, safer

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--account-id") accountId = argv[++i];
		else if (a === "--plan") plan = argv[++i];
		else if (a === "--dry-run") dryRun = true;
		else if (a === "--drop-source-schemas") keepSourceSchemas = false;
	}

	if (!accountId || !plan) {
		console.error(
			"Usage: bun run packages/provisioner/src/migrate-tenant.ts --account-id <uuid> --plan launch|grow|scale|enterprise [--dry-run] [--drop-source-schemas]",
		);
		process.exit(1);
	}
	if (!["launch", "grow", "scale", "enterprise"].includes(plan)) {
		console.error(`Invalid plan: ${plan}`);
		process.exit(1);
	}
	return {
		accountId,
		plan: plan as PlanId,
		dryRun,
		keepSourceSchemas,
	};
}

// ── Helpers ────────────────────────────────────────────────────────────

interface SubgraphRow {
	id: string;
	name: string;
	schema_name: string | null;
	handler_path: string;
	handler_code: string | null;
	source_code: string | null;
	definition: unknown;
	version: string;
	schema_hash: string;
	start_block: number;
	last_processed_block: number;
	status: string;
}

async function listSubgraphsForAccount(
	accountId: string,
): Promise<SubgraphRow[]> {
	const db = getDb();
	const rows = await db
		.selectFrom("subgraphs")
		.selectAll()
		.where("account_id", "=", accountId)
		.execute();
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		schema_name: r.schema_name,
		handler_path: r.handler_path,
		handler_code: r.handler_code ?? null,
		source_code: r.source_code ?? null,
		definition: r.definition,
		version: r.version,
		schema_hash: r.schema_hash,
		start_block: Number(r.start_block ?? 0),
		last_processed_block: Number(r.last_processed_block ?? 0),
		status: r.status,
	}));
}

async function tableRowCount(
	connectionString: string,
	schema: string,
	table: string,
): Promise<number | null> {
	const client = postgres(connectionString, { max: 1, onnotice: () => {} });
	try {
		const rows = await client<{ count: string }[]>`
			SELECT count(*)::text AS count FROM ${client(schema)}.${client(table)}
		`;
		return Number(rows[0]?.count ?? 0);
	} catch {
		return null;
	} finally {
		await client.end();
	}
}

async function listTablesInSchema(
	connectionString: string,
	schema: string,
): Promise<string[]> {
	const client = postgres(connectionString, { max: 1, onnotice: () => {} });
	try {
		const rows = await client<{ tablename: string }[]>`
			SELECT tablename FROM pg_tables WHERE schemaname = ${schema}
		`;
		return rows.map((r) => r.tablename);
	} finally {
		await client.end();
	}
}

async function schemaExists(
	connectionString: string,
	schema: string,
): Promise<boolean> {
	const client = postgres(connectionString, { max: 1, onnotice: () => {} });
	try {
		const rows = await client<{ exists: boolean }[]>`
			SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schema}) AS exists
		`;
		return rows[0]?.exists === true;
	} finally {
		await client.end();
	}
}

// Shell out helper — prints stdout/stderr, throws on non-zero exit.
async function run(cmd: string[], opts?: { input?: string }): Promise<string> {
	const proc = Bun.spawn(cmd, {
		stdin: opts?.input ? new TextEncoder().encode(opts.input) : "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`Command failed (exit ${exitCode}): ${cmd.join(" ")}\nstderr: ${stderr}`,
		);
	}
	return stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
}

/**
 * Stream pg_dump of one schema from the source postgres container into
 * the tenant postgres container via pg_restore. Uses plain-text SQL
 * format (not custom) so we can rewrite schema refs during pipe if needed.
 */
async function dumpAndRestoreSchema(args: {
	sourceContainer: string;
	tenantContainer: string;
	sourceSchema: string;
	sourceUser: string;
	sourceDb: string;
	tenantUser: string;
	tenantDb: string;
}): Promise<void> {
	// pg_dump with --schema=<name> --no-owner --no-privileges → plain SQL
	const dump = Bun.spawn(
		[
			"docker",
			"exec",
			args.sourceContainer,
			"pg_dump",
			"-U",
			args.sourceUser,
			"-d",
			args.sourceDb,
			"--schema",
			args.sourceSchema,
			"--no-owner",
			"--no-privileges",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);

	const restore = Bun.spawn(
		[
			"docker",
			"exec",
			"-i",
			args.tenantContainer,
			"psql",
			"-U",
			args.tenantUser,
			"-d",
			args.tenantDb,
			"--single-transaction",
			"--set",
			"ON_ERROR_STOP=1",
		],
		{ stdin: dump.stdout, stdout: "pipe", stderr: "pipe" },
	);

	const [dumpExit, restoreExit, restoreErr] = await Promise.all([
		dump.exited,
		restore.exited,
		new Response(restore.stderr).text(),
	]);

	if (dumpExit !== 0) {
		const dumpErr = await new Response(dump.stderr).text();
		throw new Error(
			`pg_dump failed for ${args.sourceSchema}: ${dumpErr.slice(0, 500)}`,
		);
	}
	if (restoreExit !== 0) {
		throw new Error(
			`pg_restore failed for ${args.sourceSchema}: ${restoreErr.slice(0, 500)}`,
		);
	}
}

async function renameSchema(
	tenantContainer: string,
	tenantUser: string,
	tenantDb: string,
	oldName: string,
	newName: string,
): Promise<void> {
	await run([
		"docker",
		"exec",
		tenantContainer,
		"psql",
		"-U",
		tenantUser,
		"-d",
		tenantDb,
		"-c",
		`ALTER SCHEMA "${oldName}" RENAME TO "${newName}";`,
	]);
}

async function copyHandlerFile(
	sourceAbsPath: string,
	tenantApiContainer: string,
	tenantProcContainer: string,
	tenantRelPath: string,
): Promise<void> {
	// Write to both api + processor volumes (they share the /data/subgraphs
	// mount via a named volume in the provisioner's container spec).
	await run([
		"docker",
		"cp",
		sourceAbsPath,
		`${tenantApiContainer}:${tenantRelPath}`,
	]);
	await run([
		"docker",
		"cp",
		sourceAbsPath,
		`${tenantProcContainer}:${tenantRelPath}`,
	]);
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = parseArgs();
	logger.info("migrate-tenant start", args);

	if (args.dryRun) {
		console.log("🔍 DRY RUN — no side effects");
	}

	const cfg = getConfig();
	const sourceAdminUrl = cfg.sourceDbAdminUrl;
	const sourceContainerName =
		process.env.SOURCE_POSTGRES_CONTAINER ?? "secondlayer-postgres-1";
	const sourceUser = process.env.POSTGRES_USER ?? "secondlayer";
	const sourceDb = process.env.POSTGRES_DB ?? "secondlayer";

	// --- 1. Discover source state ---
	const subgraphs = await listSubgraphsForAccount(args.accountId);
	if (subgraphs.length === 0) {
		console.error(`No subgraphs found for account ${args.accountId}`);
		process.exit(1);
	}
	console.log(`📋 Found ${subgraphs.length} subgraphs for account:`);
	for (const sg of subgraphs) {
		console.log(
			`   - ${sg.name} (schema: ${sg.schema_name}, status: ${sg.status}, blocks: ${sg.last_processed_block})`,
		);
	}

	// --- 2. Preflight ---
	console.log("\n🔍 Preflight checks...");
	for (const sg of subgraphs) {
		if (!sg.schema_name) {
			console.error(`   ✗ ${sg.name}: no schema_name set`);
			process.exit(1);
		}
		const exists = await schemaExists(sourceAdminUrl, sg.schema_name);
		if (!exists) {
			console.error(
				`   ✗ ${sg.name}: schema ${sg.schema_name} not found in source DB`,
			);
			process.exit(1);
		}
		if (!existsSync(sg.handler_path)) {
			console.error(
				`   ✗ ${sg.name}: handler file ${sg.handler_path} missing on disk`,
			);
			process.exit(1);
		}
		console.log(`   ✓ ${sg.name}: schema + handler present`);
	}

	if (args.dryRun) {
		console.log("\n✨ Dry-run complete. Rerun without --dry-run to execute.");
		process.exit(0);
	}

	// --- 3. Provision (or reuse) tenant ---
	console.log("\n🏗️  Provisioning tenant...");
	const db = getDb();
	const existing = await getTenantByAccount(db, args.accountId);
	let slug: string;
	let tenantTargetUrl: string;

	if (existing) {
		console.log(`   ℹ️  Tenant already exists (slug=${existing.slug}), reusing`);
		slug = existing.slug;
		const creds = await getTenantCredentials(db, slug);
		if (!creds) {
			console.error("Could not decrypt tenant credentials");
			process.exit(1);
		}
		tenantTargetUrl = creds.targetDatabaseUrl;
	} else {
		const tenant = await provisionTenant({
			accountId: args.accountId,
			plan: args.plan,
		});
		slug = tenant.slug;
		tenantTargetUrl = tenant.targetDatabaseUrl;

		const plan = getPlan(args.plan);
		const { anonKey, serviceKey } = await mintTenantKeys(
			slug,
			tenant.tenantJwtSecret,
			{ serviceGen: 1, anonGen: 1 },
		);
		await insertTenant(db, {
			accountId: args.accountId,
			slug,
			plan: args.plan,
			cpus: plan.totalCpus,
			memoryMb: plan.totalMemoryMb,
			storageLimitMb: plan.storageLimitMb,
			pgContainerId: tenant.containerIds.postgres,
			apiContainerId: tenant.containerIds.api,
			processorContainerId: tenant.containerIds.processor,
			targetDatabaseUrl: tenant.targetDatabaseUrl,
			tenantJwtSecret: tenant.tenantJwtSecret,
			anonKey,
			serviceKey,
			apiUrlInternal: tenant.apiUrlInternal,
			apiUrlPublic: tenant.apiUrlPublic,
			trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
		});
		console.log(`   ✓ Provisioned: slug=${slug}`);
	}

	const tenantContainer = `sl-pg-${slug}`;
	const tenantApiContainer = `sl-api-${slug}`;
	const tenantProcContainer = `sl-proc-${slug}`;
	const tenantUser = "secondlayer";
	const tenantDb = "secondlayer";

	// --- 4. Dump + restore each schema ---
	console.log("\n📦 Dumping + restoring subgraph schemas...");
	for (const sg of subgraphs) {
		const sourceSchema = sg.schema_name!;
		console.log(`   [${sg.name}] ${sourceSchema} → tenant`);

		// Safety: skip if schema already exists in tenant (idempotency)
		if (await schemaExists(tenantTargetUrl, sourceSchema)) {
			console.log(`     ⏭️  Already restored, skipping dump`);
		} else {
			await dumpAndRestoreSchema({
				sourceContainer: sourceContainerName,
				tenantContainer,
				sourceSchema,
				sourceUser,
				sourceDb,
				tenantUser,
				tenantDb,
			});
			console.log(`     ✓ Restored`);
		}
	}

	// --- 5. Rename schemas in tenant (drop prefix) ---
	console.log("\n🏷️  Renaming schemas (dropping account prefix)...");
	for (const sg of subgraphs) {
		const oldName = sg.schema_name!;
		const newName = `subgraph_${sg.name.replace(/-/g, "_")}`;
		if (oldName === newName) {
			console.log(`   [${sg.name}] already ${newName}, skipping rename`);
			continue;
		}
		if (await schemaExists(tenantTargetUrl, newName)) {
			console.log(
				`   [${sg.name}] ${newName} already exists in tenant, skipping`,
			);
			continue;
		}
		await renameSchema(tenantContainer, tenantUser, tenantDb, oldName, newName);
		console.log(`   [${sg.name}] ${oldName} → ${newName}`);
	}

	// --- 6. Insert subgraph registry rows into tenant DB ---
	console.log("\n📝 Copying subgraph registry rows...");
	const tenantClient = postgres(tenantTargetUrl, {
		max: 1,
		onnotice: () => {},
	});
	try {
		for (const sg of subgraphs) {
			const newSchemaName = `subgraph_${sg.name.replace(/-/g, "_")}`;

			// Skip if already present
			const existingCount = await tenantClient<{ count: string }[]>`
				SELECT count(*)::text as count FROM subgraphs WHERE name = ${sg.name}
			`;
			if (Number(existingCount[0]?.count ?? 0) > 0) {
				console.log(
					`   [${sg.name}] already present in tenant registry, skipping`,
				);
				continue;
			}

			await tenantClient`
				INSERT INTO subgraphs (
					name, version, definition, schema_hash, handler_path,
					schema_name, start_block, last_processed_block, status,
					handler_code, source_code, account_id, api_key_id
				) VALUES (
					${sg.name}, ${sg.version}, ${JSON.stringify(sg.definition)}::jsonb,
					${sg.schema_hash}, ${sg.handler_path}, ${newSchemaName},
					${sg.start_block}, ${sg.last_processed_block}, ${sg.status},
					${sg.handler_code}, ${sg.source_code}, ${""}, ${null}
				)
			`;
			console.log(`   ✓ ${sg.name}`);
		}
	} finally {
		await tenantClient.end();
	}

	// --- 7. Copy handler files ---
	console.log("\n📄 Copying handler files to tenant containers...");
	for (const sg of subgraphs) {
		const fileName = sg.handler_path.split("/").pop() ?? `${sg.name}.js`;
		const tenantPath = `/data/subgraphs/${fileName}`;
		await copyHandlerFile(
			sg.handler_path,
			tenantApiContainer,
			tenantProcContainer,
			tenantPath,
		);
		console.log(
			`   ✓ ${sg.handler_path} → ${tenantApiContainer}:${tenantPath}`,
		);
	}

	// --- 8. Verify row counts ---
	console.log("\n🔎 Verifying row counts...");
	let allMatch = true;
	for (const sg of subgraphs) {
		const sourceSchema = sg.schema_name!;
		const tables = await listTablesInSchema(sourceAdminUrl, sourceSchema);
		for (const table of tables) {
			const newSchemaName = `subgraph_${sg.name.replace(/-/g, "_")}`;
			const sourceCount = await tableRowCount(
				sourceAdminUrl,
				sourceSchema,
				table,
			);
			const tenantCount = await tableRowCount(
				tenantTargetUrl,
				newSchemaName,
				table,
			);
			const ok = sourceCount === tenantCount;
			if (!ok) allMatch = false;
			console.log(
				`   ${ok ? "✓" : "✗"} ${sg.name}.${table}: source=${sourceCount}, tenant=${tenantCount}`,
			);
		}
	}
	if (!allMatch) {
		console.error(
			"\n❌ Some tables have mismatched row counts. Investigate before continuing.",
		);
		process.exit(1);
	}

	// --- 9. Next steps ---
	const apiUrlPublic = existing
		? ((await getTenantCredentials(db, slug))?.apiUrlPublic ??
			`https://${slug}.${cfg.tenantBaseDomain}`)
		: `https://${slug}.${cfg.tenantBaseDomain}`;

	console.log(`
✅ Migration complete.

Tenant slug: ${slug}
Tenant URL:  ${apiUrlPublic}

Next steps:
  1. Point CLI at the tenant:
       sl instance connect ${apiUrlPublic} --key <service-key-from-dashboard>
  2. Verify from tenant: sl subgraphs list
  3. Tail logs: docker logs ${tenantApiContainer} --follow
  4. ${args.keepSourceSchemas ? "Source schemas PRESERVED. Drop them manually after verification:" : "Source schemas DROPPED."}
${
	args.keepSourceSchemas
		? subgraphs
				.map(
					(sg) =>
						`       docker exec ${sourceContainerName} psql -U ${sourceUser} -d ${sourceDb} -c 'DROP SCHEMA "${sg.schema_name}" CASCADE;'`,
				)
				.join("\n")
		: ""
}
`);

	if (!args.keepSourceSchemas) {
		console.log("\n🗑️  Dropping source schemas (--drop-source-schemas)...");
		for (const sg of subgraphs) {
			await run([
				"docker",
				"exec",
				sourceContainerName,
				"psql",
				"-U",
				sourceUser,
				"-d",
				sourceDb,
				"-c",
				`DROP SCHEMA "${sg.schema_name}" CASCADE;`,
			]);
			console.log(`   ✓ Dropped ${sg.schema_name}`);
		}
	}
}

main().catch((err) => {
	console.error(
		"❌ Migration failed:",
		err instanceof Error ? err.message : err,
	);
	process.exit(1);
});
