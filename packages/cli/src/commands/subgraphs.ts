import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	watch,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { confirm } from "@inquirer/prompts";
import type { ByoBreakingChangeDetails } from "@secondlayer/sdk";
import { ByoBreakingChangeError } from "@secondlayer/sdk";
import type { SubgraphDetail } from "@secondlayer/shared/schemas";
import { TRAIT_STANDARDS } from "@secondlayer/stacks/clarity";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import type { Command } from "commander";
import { generateSubgraphScaffold } from "../generators/subgraph-scaffold.ts";
import { generateSubgraphConsumer } from "../generators/subgraphs.ts";
import {
	backfillSubgraphApi,
	deleteSubgraphApi,
	deploySubgraphApi,
	getSubgraphAgentSchema,
	getSubgraphApi,
	getSubgraphGaps,
	getSubgraphMarkdown,
	getSubgraphOpenApi,
	handleApiError,
	listSubgraphsApi,
	publishSubgraphApi,
	querySubgraphTable,
	querySubgraphTableCount,
	reindexSubgraphApi,
	stopSubgraphApi,
	unpublishSubgraphApi,
} from "../lib/api-client.ts";
import type { SubgraphQueryParams } from "../lib/api-client.ts";
type SubgraphSpecFormat = "openapi" | "agent" | "markdown";
import { loadConfig, requireLocalNetwork } from "../lib/config.ts";
import { parseQueryFilters } from "../lib/filter-params.ts";
import { writeTextFile } from "../lib/fs.ts";
import {
	dim,
	error,
	formatKeyValue,
	formatTable,
	green,
	info,
	red,
	success,
	warn,
	yellow,
} from "../lib/output.ts";
import { requireAuth } from "../lib/require-auth.ts";
import { resolveAuth } from "../lib/resolve-auth.ts";
import { parseApiResponse } from "../parsers/clarity.ts";
import {
	SUBGRAPH_TEMPLATE_DESCRIPTIONS,
	SUBGRAPH_TEMPLATE_SLUGS,
	type SubgraphTemplateSlug,
	generateSubgraphTemplate,
} from "../templates/subgraph.ts";
import { StacksApiClient } from "../utils/api.ts";
import { inferNetwork } from "../utils/network.ts";
import { deriveBaseUrl } from "../utils/urls.ts";

/** Import the handler file; if it fails with ERR_MODULE_NOT_FOUND for
 *  `@secondlayer/subgraphs` (the required SDK), offer to install it before
 *  giving up. Other errors bubble. */
async function loadSubgraphWithDepCheck(
	absPath: string,
): Promise<{ default?: SubgraphDefinition } & SubgraphDefinition> {
	try {
		return await import(absPath);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		const code = (err as { code?: string } | undefined)?.code;
		const missingSdk =
			(code === "ERR_MODULE_NOT_FOUND" ||
				msg.includes("ERR_MODULE_NOT_FOUND")) &&
			msg.includes("@secondlayer/subgraphs");
		if (!missingSdk) throw err;
		warn("Missing dependency: @secondlayer/subgraphs");
		const install = await confirm({
			message: "Install with `bun add @secondlayer/subgraphs`?",
			default: true,
		});
		if (!install) throw err;
		await new Promise<void>((res, rej) => {
			const child = spawn("bun", ["add", "@secondlayer/subgraphs"], {
				stdio: "inherit",
			});
			child.on("error", rej);
			child.on("exit", (c) =>
				c === 0 ? res() : rej(new Error(`bun add exit ${c}`)),
			);
		});
		return await import(absPath);
	}
}

/** Run `bunx tsc --noEmit` against the handler file using the user's local
 *  TypeScript install. Throws if the type-check reports any errors. */
async function typecheckHandler(absPath: string): Promise<void> {
	await new Promise<void>((res, rej) => {
		const child = spawn(
			"bunx",
			["tsc", "--noEmit", "--allowJs", "--target", "es2022", absPath],
			{ stdio: "inherit" },
		);
		child.on("error", (err) =>
			rej(
				new Error(
					`Failed to run tsc — install typescript (\`bun add -d typescript\`) or drop --strict. (${err.message})`,
				),
			),
		);
		child.on("exit", (code) => {
			if (code === 0) res();
			else rej(new Error(`Type-check failed (tsc exit ${code})`));
		});
	});
}

export function parseStartBlockOption(value?: string): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
		throw new Error("--start-block must be a nonnegative integer");
	}
	const parsed = Number(trimmed);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error("--start-block must be a safe integer");
	}
	return parsed;
}

export function parseVisibilityOption(
	value?: string,
): "public" | "private" | undefined {
	if (value === undefined) return undefined;
	if (value === "public" || value === "private") return value;
	throw new Error('--visibility must be "public" or "private"');
}

export function parseSubgraphSpecFormat(value?: string): SubgraphSpecFormat {
	const format = value ?? "openapi";
	if (format === "openapi" || format === "agent" || format === "markdown") {
		return format;
	}
	throw new Error("--format must be one of: openapi, agent, markdown");
}

function formatSubgraphSpecOutput(
	spec: unknown,
	format: SubgraphSpecFormat,
): string {
	if (typeof spec === "string") return spec;
	if (format === "markdown") return String(spec);
	return `${JSON.stringify(spec, null, 2)}\n`;
}

async function writeOrPrintSubgraphSpec(
	spec: unknown,
	format: SubgraphSpecFormat,
	output?: string,
): Promise<void> {
	const text = formatSubgraphSpecOutput(spec, format);
	if (!output) {
		process.stdout.write(text);
		return;
	}
	const outPath = resolve(output);
	const dir = resolve(outPath, "..");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	await writeTextFile(outPath, text);
	success(`Created ${outPath}`);
}

/** Build an API spec from a local subgraph .ts file (bundle → synthetic detail). */
async function specFromLocalFile(
	absPath: string,
	format: SubgraphSpecFormat,
	specOptions: { serverUrl: string } | undefined,
): Promise<unknown> {
	const { readFile } = await import("node:fs/promises");
	const { bundleSubgraphCode } = await import("@secondlayer/bundler");
	const { generateSubgraphSQL } = await import("@secondlayer/subgraphs");
	const {
		generateSubgraphAgentSchema,
		generateSubgraphMarkdown,
		generateSubgraphOpenApi,
	} = await import("@secondlayer/shared/subgraphs/spec");
	const source = await readFile(absPath, "utf8");
	const bundled = await bundleSubgraphCode(source);
	const { hash } = generateSubgraphSQL({
		name: bundled.name,
		version: bundled.version,
		description: bundled.description,
		sources: bundled.sources as unknown as SubgraphDefinition["sources"],
		schema: bundled.schema as SubgraphDefinition["schema"],
		handlers: {},
	});
	const detail = createLocalSubgraphDetail({
		name: bundled.name,
		version: bundled.version,
		description: bundled.description,
		sources: bundled.sources,
		schema: bundled.schema,
		schemaHash: hash,
	});
	return format === "openapi"
		? generateSubgraphOpenApi(detail, specOptions)
		: format === "agent"
			? generateSubgraphAgentSchema(detail, specOptions)
			: generateSubgraphMarkdown(detail, specOptions);
}

function createLocalSubgraphDetail(input: {
	name: string;
	version?: string;
	description?: string;
	sources: Record<string, Record<string, unknown>>;
	schema: Record<string, unknown>;
	schemaHash: string;
}): SubgraphDetail {
	const tables: SubgraphDetail["tables"] = {};
	for (const [tableName, rawTable] of Object.entries(input.schema)) {
		const table = rawTable as {
			columns?: Record<
				string,
				{
					type?: string;
					nullable?: boolean;
					indexed?: boolean;
					search?: boolean;
					default?: string | number | boolean;
				}
			>;
			indexes?: string[][];
			uniqueKeys?: string[][];
		};
		const columns: SubgraphDetail["tables"][string]["columns"] = {};
		for (const [columnName, column] of Object.entries(table.columns ?? {})) {
			columns[columnName] = {
				type: column.type ?? "text",
				...(column.nullable && { nullable: true }),
				...(column.indexed && { indexed: true }),
				...(column.search && { searchable: true }),
				...(column.default !== undefined && { default: column.default }),
			};
		}
		columns._id = { type: "serial" };
		columns._block_height = { type: "bigint" };
		columns._tx_id = { type: "text" };
		columns._created_at = { type: "timestamp" };
		tables[tableName] = {
			endpoint: `/subgraphs/${input.name}/${tableName}`,
			columns,
			rowCount: 0,
			example: `/subgraphs/${input.name}/${tableName}?_sort=_block_height&_order=desc&_limit=10`,
			...(table.indexes && { indexes: table.indexes }),
			...(table.uniqueKeys && { uniqueKeys: table.uniqueKeys }),
		};
	}
	return {
		name: input.name,
		version: input.version ?? "0.0.0",
		schemaHash: input.schemaHash,
		status: "local",
		lastProcessedBlock: 0,
		...(input.description && { description: input.description }),
		sources: input.sources,
		health: {
			totalProcessed: 0,
			totalErrors: 0,
			errorRate: 0,
			lastError: null,
			lastErrorAt: null,
		},
		sync: {
			status: "synced",
			startBlock: 0,
			lastProcessedBlock: 0,
			chainTip: 0,
			blocksRemaining: 0,
			progress: 1,
			gaps: { count: 0, totalMissingBlocks: 0, ranges: [] },
			integrity: "complete",
		},
		tables,
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString(),
	};
}

function readCliSubgraphsDependency(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(here, "..", "..", "package.json"),
		resolve(here, "..", "package.json"),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
			dependencies?: Record<string, string>;
		};
		const dep = pkg.dependencies?.["@secondlayer/subgraphs"];
		if (dep) return dep;
	}
	return "^1.3.2";
}

export function ensureScaffoldPackageJson(dir: string): void {
	const packagePath = join(dir, "package.json");
	const subgraphsDep = readCliSubgraphsDependency();
	if (!existsSync(packagePath)) {
		writeFileSync(
			packagePath,
			`${JSON.stringify(
				{
					type: "module",
					dependencies: {
						"@secondlayer/subgraphs": subgraphsDep,
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		return;
	}

	const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
		dependencies?: Record<string, string>;
	};
	if (pkg.dependencies?.["@secondlayer/subgraphs"]) return;
	pkg.dependencies = {
		...(pkg.dependencies ?? {}),
		"@secondlayer/subgraphs": subgraphsDep,
	};
	writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

export type ScaffoldDependencyInstaller = (dir: string) => Promise<void>;

async function runBunInstall(dir: string): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const proc = spawn("bun", ["install"], {
			cwd: dir,
			stdio: "inherit",
		});

		proc.on("error", reject);
		proc.on("close", (exitCode, signal) => {
			if (exitCode === 0) {
				resolvePromise();
				return;
			}
			if (exitCode !== null) {
				reject(new Error(`bun install exited with code ${exitCode}`));
				return;
			}
			reject(new Error(`bun install exited with signal ${signal}`));
		});
	});
}

export async function installScaffoldDependencies(
	dir: string,
	options: {
		install?: boolean;
		installer?: ScaffoldDependencyInstaller;
	} = {},
): Promise<"installed" | "skipped"> {
	if (options.install === false) return "skipped";
	await (options.installer ?? runBunInstall)(dir);
	return "installed";
}

export interface SubgraphDeployPreview {
	name: string;
	version: string;
	description: string;
	startBlock: string;
	sources: string;
	handlers: string;
	tables: string;
	tableColumns: string[];
	bundleSize?: string;
}

export function createSubgraphDeployPreview(
	def: SubgraphDefinition,
	options: { bundleBytes?: number } = {},
): SubgraphDeployPreview {
	const tableColumns = Object.entries(def.schema).map(
		([table, schema]) =>
			`${table}: ${Object.keys(schema.columns).join(", ") || "(no columns)"}`,
	);

	return {
		name: def.name,
		version: def.version ?? "(auto)",
		description: def.description ?? "",
		startBlock: String(def.startBlock ?? 1),
		sources: Object.keys(def.sources).join(", ") || "(none)",
		handlers: Object.keys(def.handlers).join(", ") || "(none)",
		tables: Object.keys(def.schema).join(", ") || "(none)",
		tableColumns,
		...(options.bundleBytes !== undefined
			? { bundleSize: `${options.bundleBytes} bytes` }
			: {}),
	};
}

function printSubgraphDeployPreview(
	preview: SubgraphDeployPreview,
	context: { network: string; file: string; bundled: boolean },
): void {
	success("Subgraph deploy dry run passed");
	const pairs: [string, string][] = [
		["File", context.file],
		["Network", context.network],
		["Name", preview.name],
		["Version", preview.version],
		["Start Block", preview.startBlock],
		["Sources", preview.sources],
		["Handlers", preview.handlers],
		["Tables", preview.tables],
	];
	if (preview.bundleSize) pairs.push(["Bundle Size", preview.bundleSize]);

	console.log(formatKeyValue(pairs));

	if (preview.description) {
		console.log(`\n${dim("Description")}  ${preview.description}`);
	}
	if (preview.tableColumns.length > 0) {
		console.log(`\n${dim("Columns")}`);
		for (const line of preview.tableColumns) console.log(`  ${line}`);
	}

	const deployTarget = context.bundled ? "tenant API" : "local database";
	info(`Dry run only. No ${deployTarget} changes were made.`);
}

/**
 * Render a refused BYO breaking-change deploy: the breaking reasons plus the
 * exact DROP + rebuild DDL to run manually on the user's own database. No data
 * was dropped — the server refused; this only shows what a rebuild would take.
 */
function printByoBreakingPlan(details: ByoBreakingChangeDetails): void {
	error("Refusing breaking schema change on BYO subgraph (no data dropped).");
	console.log("\nBreaking changes:");
	for (const r of details.reasons) console.log(`  ${red("✗")} ${r}`);
	console.log("\nTo rebuild manually, run on YOUR database:");
	console.log(`  ${details.plan.dropStatement}`);
	console.log(`  ${details.plan.statements.join(";\n  ")}`);
	console.log("\nGrant (first deploy only):");
	for (const line of details.plan.grantScript.split("\n")) {
		console.log(`  ${dim(line)}`);
	}
	console.log(
		`\n${yellow("This DROPS all rows in that schema, then rebuilds it. Re-deploy after.")}`,
	);
	console.log(
		dim(
			"(--force destructive rebuild not yet supported — manual DROP required.)",
		),
	);
}

function formatSubgraphSync(sync: {
	status: string;
	mode?: "sync" | "reindex";
	lastProcessedBlock: number;
	chainTip: number;
	targetBlock?: number;
	sourceChainTip?: number;
	blocksRemaining: number;
	processedBlocks?: number;
	totalBlocks?: number;
	progress: number;
}): { line: string; remainingLabel: string; remaining: string } {
	const targetBlock = sync.targetBlock ?? sync.chainTip;
	const totalBlocks = sync.totalBlocks;
	const processedBlocks = sync.processedBlocks;
	const progress = `${(sync.progress * 100).toFixed(1)}%`;

	if (sync.status === "reindexing" || sync.mode === "reindex") {
		if (targetBlock <= 0) {
			return {
				line: `reindexing — cursor #${sync.lastProcessedBlock} (target unavailable from API)`,
				remainingLabel: "Reindex Remaining",
				remaining: "N/A",
			};
		}
		const range =
			processedBlocks !== undefined && totalBlocks !== undefined
				? `${processedBlocks} / ${totalBlocks} blocks`
				: `${sync.lastProcessedBlock} / ${targetBlock}`;
		return {
			line: `reindexing — ${progress} (${range}, target #${targetBlock})`,
			remainingLabel: "Reindex Remaining",
			remaining: String(sync.blocksRemaining),
		};
	}

	return {
		line: `${sync.status} — ${progress} (${sync.lastProcessedBlock} / ${targetBlock})`,
		remainingLabel: "Blocks Remaining",
		remaining: String(sync.blocksRemaining),
	};
}

export function registerSubgraphsCommand(program: Command): void {
	const subgraphs = program
		.command("subgraphs")
		.description("Manage materialized subgraphs");

	// --- new ---
	subgraphs
		.command("create <name>")
		.description("Create a new subgraph definition file")
		.option(
			"--template <slug>",
			`Starter template (one of: ${SUBGRAPH_TEMPLATE_SLUGS.join(", ")})`,
		)
		.addHelpText(
			"after",
			`
Examples:
  $ sl subgraphs create my-graph
  $ sl subgraphs create token-balances --template sip-010-balances`,
		)
		.action(async (name: string, opts: { template?: string }) => {
			const slug = (opts.template ?? "basic") as SubgraphTemplateSlug;
			if (!SUBGRAPH_TEMPLATE_SLUGS.includes(slug)) {
				error(
					`Unknown template "${opts.template}". Available templates:\n${SUBGRAPH_TEMPLATE_SLUGS.map(
						(s) => `  ${s.padEnd(20)} ${SUBGRAPH_TEMPLATE_DESCRIPTIONS[s]}`,
					).join("\n")}`,
				);
				process.exit(1);
			}

			const dir = resolve("subgraphs");
			const filePath = resolve(dir, `${name}.ts`);

			if (existsSync(filePath)) {
				error(`File already exists: ${filePath}`);
				process.exit(1);
			}

			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			const content = generateSubgraphTemplate(name, slug);
			await writeTextFile(filePath, content);

			success(`Created ${filePath}`);
			if (slug !== "basic") {
				info(`Template: ${slug} — ${SUBGRAPH_TEMPLATE_DESCRIPTIONS[slug]}`);
			}
			info(`Next: sl subgraphs deploy subgraphs/${name}.ts`);
		});

	// --- dev ---
	subgraphs
		.command("dev <file>")
		.description("Watch a subgraph file and auto-redeploy on change")
		.action(async (file: string) => {
			await requireLocalNetwork();

			const absPath = resolve(file);
			if (!existsSync(absPath)) {
				error(`File not found: ${absPath}`);
				process.exit(1);
			}

			info(`Watching ${absPath} for changes...`);
			info("Press Ctrl+C to stop\n");

			const deploySubgraph = async () => {
				try {
					// Clear module cache for hot reload
					delete require.cache[absPath];
					const mod = await import(`${absPath}?t=${Date.now()}`);
					const def = mod.default ?? mod;

					const { validateSubgraphDefinition } = await import(
						"@secondlayer/subgraphs/validate"
					);
					const { deploySchema } = await import("@secondlayer/subgraphs");
					const { getDb } = await import("@secondlayer/shared/db");

					validateSubgraphDefinition(def);
					const db = getDb();
					const result = await deploySchema(db, def, absPath, {
						forceReindex: false,
					});

					if (result.action === "unchanged") {
						info(`[${new Date().toLocaleTimeString()}] No schema changes`);
					} else if (result.action === "created") {
						success(
							`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" created`,
						);
					} else if (result.action === "updated") {
						success(
							`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" updated (additive)`,
						);
					} else if (result.action === "reindexed") {
						success(
							`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" reindexed (breaking schema change)`,
						);
					} else {
						success(
							`[${new Date().toLocaleTimeString()}] Subgraph "${def.name}" deployed (${result.action})`,
						);
					}

					// Show handler stats
					const handlerKeys = Object.keys(def.handlers);
					info(`  Handlers: ${handlerKeys.join(", ")}`);
				} catch (err) {
					error(`[${new Date().toLocaleTimeString()}] ${err}`);
				}
			};

			// Initial deploy
			await deploySubgraph();

			// Watch with debounce
			let timeout: ReturnType<typeof setTimeout> | null = null;
			const watcher = watch(absPath, () => {
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(async () => {
					console.log("");
					info("File changed, redeploying...");
					await deploySubgraph();
				}, 300);
			});

			// Graceful shutdown
			process.on("SIGINT", () => {
				watcher.close();
				if (timeout) clearTimeout(timeout);
				console.log("\nStopped watching.");
				process.exit(0);
			});

			// Keep process alive
			await new Promise(() => {});
		});

	// --- deploy ---
	subgraphs
		.command("deploy <file>")
		.alias("update")
		.description(
			"Deploy a subgraph definition file (alias: update — deploy is create-or-update)",
		)
		.option(
			"--start-block <n>",
			"Override the subgraph definition startBlock for this deploy",
		)
		.option("--dry-run", "Validate and preview deploy without writing changes")
		.option("-y, --yes", "Skip the reindex confirmation prompt")
		.option(
			"--database-url <url>",
			"BYO data plane: write the subgraph's schema/rows to your own Postgres. With --dry-run, prints the DDL + grant script and verifies the connection.",
		)
		.option(
			"--strict",
			"Run `tsc --noEmit` against the handler before deploy (slower; catches TS type errors)",
		)
		.option(
			"--visibility <visibility>",
			"Read visibility: public (anon /v1 reads, global name claim) or private (your key only). Defaults: managed → public, BYO → private.",
		)
		.action(
			async (
				file: string,
				options: {
					startBlock?: string;
					dryRun?: boolean;
					yes?: boolean;
					strict?: boolean;
					databaseUrl?: string;
					visibility?: string;
				},
			) => {
				try {
					const absPath = resolve(file);
					const config = await loadConfig();
					if (config.network !== "local") {
						// Remote deploys hit the platform API; prompt for login if no
						// session rather than failing with a generic 401 mid-flow.
						await requireAuth();
					}
					const dryRun = options.dryRun;
					const visibility = parseVisibilityOption(options.visibility);
					if (visibility === "public" && options.databaseUrl && !options.yes) {
						const confirmed = await confirm({
							message:
								"⚠  Public BYO subgraph: anonymous reads will query YOUR database. Continue?",
						});
						if (!confirmed) {
							info("Aborted.");
							process.exit(0);
						}
					}
					const startBlock = parseStartBlockOption(options.startBlock);
					if (startBlock !== undefined) {
						warn(
							`--start-block ${startBlock} overrides the definition's startBlock for this deploy.`,
						);
					}

					if (options.strict) {
						info("Type-checking handler (tsc --noEmit)...");
						await typecheckHandler(absPath);
					}

					// Load and validate locally for fast feedback
					info(`Loading subgraph from ${absPath}`);
					const mod = await loadSubgraphWithDepCheck(absPath);
					const def = mod.default ?? mod;
					const effectiveDef =
						startBlock === undefined ? def : { ...def, startBlock };
					const { validateSubgraphDefinition } = await import(
						"@secondlayer/subgraphs/validate"
					);
					const validated = validateSubgraphDefinition(effectiveDef);

					if (config.network !== "local") {
						// ── Remote deploy ──────────────────────────────────────
						info(
							`${dryRun ? "Bundling for remote deploy dry run" : "Bundling for remote deploy"} (${config.network})...`,
						);

						const { readFile } = await import("node:fs/promises");
						const source = await readFile(absPath, "utf8");
						const { bundleSubgraphCode } = await import("@secondlayer/bundler");
						const bundled = await bundleSubgraphCode(source);
						const handlerCode = bundled.handlerCode;

						if (dryRun) {
							printSubgraphDeployPreview(
								createSubgraphDeployPreview(
									{
										...validated,
										version: validated.version,
									},
									{
										bundleBytes: Buffer.byteLength(handlerCode, "utf8"),
									},
								),
								{
									network: config.network,
									file: absPath,
									bundled: true,
								},
							);
							return;
						}

						// The server decides whether this creates, updates, or reindexes.
						// Always forward startBlock — CLI flag takes priority, then definition file.
						const deployStartBlock = startBlock ?? effectiveDef.startBlock;
						if (options.databaseUrl) {
							info(
								"BYO data plane: schema + rows will live in your database. The server verifies the connection before deploying.",
							);
						}
						const result = await deploySubgraphApi({
							name: effectiveDef.name,
							version: undefined,
							description: effectiveDef.description,
							sources: effectiveDef.sources as unknown as Record<
								string,
								Record<string, unknown>
							>,
							schema: effectiveDef.schema,
							handlerCode,
							sourceCode: source,
							...(deployStartBlock !== undefined
								? { startBlock: deployStartBlock }
								: {}),
							...(options.databaseUrl
								? { databaseUrl: options.databaseUrl }
								: {}),
							...(visibility ? { visibility } : {}),
						});

						if (result.start_block_clamped) {
							info(
								`  Free tier indexes forward from deploy (start block ${result.start_block}) — upgrade for genesis backfill.`,
							);
						}

						const printDeployFooter = async () => {
							try {
								const { apiUrl } = await resolveAuth();
								const baseUrl = deriveBaseUrl(apiUrl);
								const firstTable = Object.keys(effectiveDef.schema ?? {})[0];
								const isPublic = result.visibility === "public";
								info(
									`  Dashboard: ${baseUrl}/platform/subgraphs/${effectiveDef.name}`,
								);
								if (isPublic && firstTable) {
									info(
										`  Read:      ${apiUrl}/v1/subgraphs/${effectiveDef.name}/${firstTable}`,
									);
									info(
										`  Share:     ${apiUrl}/v1/subgraphs/${effectiveDef.name} (public — no key needed)`,
									);
								} else if (firstTable) {
									info(
										`  REST:      ${apiUrl}/api/subgraphs/${effectiveDef.name}/${firstTable}`,
									);
									info(
										`  Publish:   sl subgraphs publish ${effectiveDef.name} (open anon /v1 reads)`,
									);
								}
								info(`  Watch:     sl subgraphs status ${effectiveDef.name}`);
								if (firstTable) {
									info(
										`  Webhook:   sl subscriptions create ${effectiveDef.name}-hook --subgraph ${effectiveDef.name} --table ${firstTable} --url <your-endpoint>`,
									);
								}
							} catch {
								// Footer is decorative — never block deploy on URL derivation
							}
						};

						if (result.action === "unchanged") {
							info(
								`Subgraph "${effectiveDef.name}" is up to date (v${result.version} — no changes)`,
							);
						} else if (result.action === "handler_updated") {
							success(
								`Subgraph "${effectiveDef.name}" handler updated (v${result.version} — schema unchanged, no reindex needed)`,
							);
						} else if (result.action === "created") {
							// Fresh deploy — no existing data to drop, no confirmation needed
							success(
								`Subgraph "${effectiveDef.name}" created → v${result.version}`,
							);
							await printDeployFooter();
						} else if (result.action === "reindexed") {
							// Show diff if available
							if (result.diff) {
								const { addedTables, addedColumns, breakingChanges } =
									result.diff;
								if (breakingChanges.length > 0) {
									warn("Breaking changes detected:");
									for (const r of breakingChanges) warn(`  ✗ ${r}`);
								}
								if (addedTables.length > 0)
									info(`  + tables: ${addedTables.join(", ")}`);
								for (const [t, cols] of Object.entries(addedColumns)) {
									info(`  + columns: ${t}.${cols.join(", ")}`);
								}
							}

							// Confirmation prompt — dropping existing data (skippable with --yes)
							const confirmed =
								options.yes ||
								(await confirm({
									message:
										"⚠  This will drop all data and reindex from scratch. Continue?",
								}));
							if (!confirmed) {
								info("Aborted.");
								process.exit(0);
							}

							success(
								`Subgraph "${effectiveDef.name}" updated → v${result.version} (reindexing)`,
							);
							await printDeployFooter();
						} else {
							// "updated" — additive changes, no confirmation needed
							if (result.diff) {
								const { addedTables, addedColumns } = result.diff;
								if (addedTables.length > 0)
									info(`  + tables: ${addedTables.join(", ")}`);
								for (const [t, cols] of Object.entries(addedColumns)) {
									info(`  + columns: ${t}.${cols.join(", ")}`);
								}
							}
							success(
								`Subgraph "${effectiveDef.name}" updated → v${result.version}`,
							);
							await printDeployFooter();
						}
					} else {
						// ── Local deploy ───────────────────────────────────────
						if (dryRun) {
							printSubgraphDeployPreview(
								createSubgraphDeployPreview({
									...validated,
									version: validated.version,
								}),
								{
									network: config.network,
									file: absPath,
									bundled: false,
								},
							);
							return;
						}

						const { deploySchema } = await import("@secondlayer/subgraphs");
						const { getDb, closeDb } = await import("@secondlayer/shared/db");

						const db = getDb();
						const result = await deploySchema(db, effectiveDef, absPath, {
							version: undefined,
							forceReindex: startBlock !== undefined,
						});

						if (result.action === "unchanged") {
							info(
								`Subgraph "${effectiveDef.name}" is up to date (v${result.version} — no changes)`,
							);
						} else if (result.action === "handler_updated") {
							success(
								`Subgraph "${effectiveDef.name}" handler updated (v${result.version} — schema unchanged, no reindex needed)`,
							);
						} else if (result.action === "created") {
							success(
								`Subgraph "${effectiveDef.name}" created → v${result.version}`,
							);
						} else if (result.action === "reindexed") {
							success(
								`Subgraph "${effectiveDef.name}" updated → v${result.version} (reindexing)`,
							);
						} else {
							success(
								`Subgraph "${effectiveDef.name}" updated → v${result.version}`,
							);
						}

						await closeDb();
					}
				} catch (err) {
					// Remote deploy: the SDK throws the typed error (same module → instanceof).
					if (err instanceof ByoBreakingChangeError) {
						printByoBreakingPlan(err.details);
						process.exit(1);
					}
					// Local deploy throws the subgraphs-bundle class — match it by shape
					// to avoid a cross-package instanceof. (Local BYO is unreachable today;
					// guard is defensive for when --database-url reaches local deploy.)
					if (
						err &&
						typeof err === "object" &&
						(err as { code?: unknown }).code === "BYO_BREAKING_CHANGE" &&
						(err as { details?: unknown }).details
					) {
						printByoBreakingPlan(
							(err as { details: ByoBreakingChangeDetails }).details,
						);
						process.exit(1);
					}
					error(`Failed to deploy subgraph: ${err}`);
					process.exit(1);
				}
			},
		);

	// --- list ---
	subgraphs
		.command("list")
		.alias("ls")
		.description("List all deployed subgraphs")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const { data } = await listSubgraphsApi();

				if (options.json) {
					console.log(JSON.stringify(data, null, 2));
					return;
				}

				if (data.length === 0) {
					console.log("No subgraphs deployed");
					return;
				}

				const tableRows = data.map((v) => {
					const statusColor =
						v.status === "active" ? green : v.status === "error" ? red : yellow;
					return [
						v.name,
						v.version,
						statusColor(v.status),
						String(v.lastProcessedBlock),
						v.tables.join(", ") || "—",
					];
				});

				console.log(
					formatTable(
						["Name", "Version", "Status", "Last Block", "Tables"],
						tableRows,
					),
				);
				console.log(dim(`\n${data.length} subgraph(s) total`));
			} catch (err) {
				handleApiError(err, "list subgraphs");
			}
		});

	// --- status ---
	subgraphs
		.command("status <name>")
		.alias("get")
		.description("Show detailed subgraph status")
		.option("-w, --watch", "Refresh every 2s until synced or Ctrl-C")
		.action(async (name: string, options: { watch?: boolean }) => {
			const renderOnce = async () => {
				const subgraph = await getSubgraphApi(name);

				const rowCounts =
					Object.entries(subgraph.tables)
						.map(
							([t, info]: [string, { rowCount: number }]) =>
								`${t}: ${info.rowCount}`,
						)
						.join(", ") || "N/A";
				const totalRows = Object.values(subgraph.tables).reduce(
					(sum, info: { rowCount: number }) => sum + info.rowCount,
					0,
				);

				const errorRate =
					subgraph.health.totalProcessed > 0
						? `${(subgraph.health.errorRate * 100).toFixed(2)}%`
						: "N/A";

				const sync = subgraph.sync;
				const syncDisplay = sync
					? formatSubgraphSync(sync)
					: {
							line: "unknown",
							remainingLabel: "Blocks Remaining",
							remaining: "N/A",
						};

				// Gap summary
				const gapSummary =
					sync && sync.gaps.count > 0
						? `${sync.gaps.count} unresolved (${sync.gaps.totalMissingBlocks} missing blocks)`
						: "none";
				const integrity = sync?.integrity ?? "unknown";

				console.log(
					formatKeyValue([
						["Name", subgraph.name],
						["Version", subgraph.version],
						["Status", subgraph.status],
						["Sync", syncDisplay.line],
						[syncDisplay.remainingLabel, syncDisplay.remaining],
						["Integrity", integrity],
						["Gaps", gapSummary],
						["Last Block", String(subgraph.lastProcessedBlock)],
						["Rows Indexed", totalRows.toLocaleString()],
						["Table Rows", rowCounts],
						["Total Errors", String(subgraph.health.totalErrors)],
						["Error Rate", errorRate],
						["Last Error", subgraph.health.lastError ?? "none"],
						["Last Error At", subgraph.health.lastErrorAt ?? "N/A"],
						["Created", subgraph.createdAt],
						["Updated", subgraph.updatedAt],
					]),
				);

				if (sync && sync.gaps.count > 0) {
					console.log(dim(`\nRun: sl subgraphs gaps ${name}`));
				}

				// Show table endpoints
				const tableEntries = Object.entries(subgraph.tables);
				if (tableEntries.length > 0) {
					console.log(dim("\nTable endpoints:"));
					for (const [_t, info] of tableEntries as [
						string,
						{ endpoint: string },
					][]) {
						console.log(dim(`  ${info.endpoint}`));
					}
				}

				return subgraph;
			};

			try {
				if (!options.watch) {
					await renderOnce();
					return;
				}
				// eslint-disable-next-line no-constant-condition
				while (true) {
					// Clear screen so the latest snapshot replaces the previous one
					// instead of accumulating noise.
					process.stdout.write("\x1Bc");
					const sg = await renderOnce();
					if (sg && sg.status === "synced") {
						console.log(dim("\nSynced — exiting watch."));
						return;
					}
					await new Promise((res) => setTimeout(res, 2000));
				}
			} catch (err) {
				handleApiError(err, "get subgraph status");
			}
		});

	// --- spec (deployed subgraph name OR local .ts file) ---
	subgraphs
		.command("spec <nameOrFile>")
		.description(
			"Output API documentation for a deployed subgraph or a local subgraph file",
		)
		.option(
			"--format <format>",
			"Output format: openapi, agent, markdown",
			"openapi",
		)
		.option("-o, --output <path>", "Write output to a file")
		.option("--server <url>", "Override the server URL in generated docs")
		.action(
			async (
				nameOrFile: string,
				options: { format?: string; output?: string; server?: string },
			) => {
				try {
					const format = parseSubgraphSpecFormat(options.format);
					const specOptions = options.server
						? { serverUrl: options.server }
						: undefined;
					const absPath = resolve(nameOrFile);
					// A `.ts` argument is unambiguously a local file — if it's
					// missing, fail clearly rather than treating the path as a
					// deployed subgraph name (which yields a confusing 404).
					if (nameOrFile.endsWith(".ts") && !existsSync(absPath)) {
						error(`File not found: ${absPath}`);
						process.exit(1);
					}
					const isLocalFile = nameOrFile.endsWith(".ts");
					const spec = isLocalFile
						? await specFromLocalFile(absPath, format, specOptions)
						: format === "openapi"
							? await getSubgraphOpenApi(nameOrFile, specOptions)
							: format === "agent"
								? await getSubgraphAgentSchema(nameOrFile, specOptions)
								: await getSubgraphMarkdown(nameOrFile, specOptions);
					await writeOrPrintSubgraphSpec(spec, format, options.output);
				} catch (err) {
					if (err instanceof Error && err.message.startsWith("--format")) {
						error(err.message);
						process.exit(1);
					}
					handleApiError(err, "generate subgraph spec");
				}
			},
		);

	// --- codegen (ORM schema for BYO database) ---
	subgraphs
		.command("codegen <file>")
		.description(
			"Generate an ORM schema (Prisma, Drizzle, or Kysely) for a subgraph's tables — point it at your BYO database",
		)
		.option("--target <orm>", "ORM target: prisma | drizzle | kysely", "prisma")
		.option(
			"--schema <name>",
			"Postgres schema name (defaults to subgraph_<name>)",
		)
		.option("--env <var>", "datasource url env var", "DATABASE_URL")
		.option(
			"--models-only",
			"Emit only Prisma models (compose via prismaSchemaFolder)",
		)
		.option("-o, --output <path>", "Write to a file (defaults to stdout)")
		.action(
			async (
				file: string,
				options: {
					target?: string;
					schema?: string;
					env?: string;
					output?: string;
					modelsOnly?: boolean;
				},
			) => {
				try {
					const target = options.target ?? "prisma";
					if (
						target !== "prisma" &&
						target !== "drizzle" &&
						target !== "kysely"
					) {
						error(
							`Unsupported --target "${target}" (supported: prisma, drizzle, kysely).`,
						);
						process.exit(1);
					}
					const absPath = resolve(file);
					if (!existsSync(absPath)) {
						error(`File not found: ${absPath}`);
						process.exit(1);
					}
					const { readFile } = await import("node:fs/promises");
					const { bundleSubgraphCode } = await import("@secondlayer/bundler");
					const {
						generatePrismaSchema,
						generateDrizzleSchema,
						generateKyselySchema,
					} = await import("@secondlayer/subgraphs");
					const source = await readFile(absPath, "utf8");
					const bundled = await bundleSubgraphCode(source);
					const def: SubgraphDefinition = {
						name: bundled.name,
						version: bundled.version,
						description: bundled.description,
						sources:
							bundled.sources as unknown as SubgraphDefinition["sources"],
						schema: bundled.schema as SubgraphDefinition["schema"],
						handlers: {},
					};
					const out =
						target === "drizzle"
							? generateDrizzleSchema(def, { schemaName: options.schema })
							: target === "kysely"
								? generateKyselySchema(def, { schemaName: options.schema })
								: generatePrismaSchema(def, {
										schemaName: options.schema,
										datasourceEnv: options.env,
										modelsOnly: options.modelsOnly,
									});
					if (options.output) {
						await writeTextFile(resolve(options.output), out);
						success(`Wrote ${target} schema to ${options.output}`);
						const next =
							target === "prisma"
								? "point its datasource at your BYO database, then `prisma generate`."
								: target === "drizzle"
									? "point your Drizzle connection at your BYO database (treat tables read-only)."
									: "import the `DB` type into `new Kysely<DB>()` against your BYO database.";
						info(`Next: ${next}`);
					} else {
						process.stdout.write(out);
					}
				} catch (err) {
					error(`Failed to generate schema: ${err}`);
					process.exit(1);
				}
			},
		);

	// --- reindex ---
	subgraphs
		.command("reindex <name>")
		.description(
			"Reindex a subgraph from historical blocks (drops + reprocesses)",
		)
		.option("--from-block <n>", "Start block height")
		.option("--to-block <n>", "End block height")
		.option("-y, --yes", "Skip confirmation")
		.addHelpText(
			"after",
			`
Examples:
  $ sl subgraphs reindex my-graph -y
  $ sl subgraphs reindex my-graph --from-block 150000 --to-block 160000 -y`,
		)
		.action(
			async (
				name: string,
				options: {
					fromBlock?: string;
					toBlock?: string;
					yes?: boolean;
				},
			) => {
				try {
					const fromRaw = options.fromBlock;
					const toRaw = options.toBlock;
					const fromBlock = fromRaw ? Number.parseInt(fromRaw, 10) : undefined;
					const toBlock = toRaw ? Number.parseInt(toRaw, 10) : undefined;

					if (!options.yes) {
						if (!process.stdin.isTTY) {
							error(
								"Interactive prompt unavailable (stdin is not a TTY). Re-run with -y to skip confirmation.",
							);
							process.exit(1);
						}
						const { confirm } = await import("@inquirer/prompts");
						const range =
							fromBlock !== undefined && toBlock !== undefined
								? ` for blocks [${fromBlock}, ${toBlock}]`
								: fromBlock !== undefined
									? ` from block ${fromBlock}`
									: toBlock !== undefined
										? ` up to block ${toBlock}`
										: "";
						let ok = false;
						try {
							ok = await confirm({
								message: `Reindex subgraph "${name}"${range}? Existing rows in this range will be dropped and reprocessed.`,
								default: false,
							});
						} catch (promptErr) {
							const m =
								promptErr instanceof Error
									? promptErr.message
									: String(promptErr);
							if (m.includes("ExitPromptError") || m.includes("force closed")) {
								error(
									"Interactive prompt unavailable. Re-run with -y to skip confirmation.",
								);
								process.exit(1);
							}
							throw promptErr;
						}
						if (!ok) {
							info("Cancelled.");
							return;
						}
					}

					info(`Reindexing subgraph "${name}"...`);

					const result = await reindexSubgraphApi(name, {
						fromBlock,
						toBlock,
					});

					success(result.message);
					info(`From block ${result.fromBlock} to ${result.toBlock}`);
				} catch (err) {
					handleApiError(err, "reindex subgraph");
				}
			},
		);

	// --- backfill ---
	subgraphs
		.command("backfill <name>")
		.description("Backfill a block range without dropping existing data")
		.option("--from-block <n>", "Start block height")
		.option("--to-block <n>", "End block height")
		.addHelpText(
			"after",
			`
Examples:
  $ sl subgraphs backfill my-graph --from-block 150000 --to-block 160000`,
		)
		.action(
			async (
				name: string,
				options: {
					fromBlock?: string;
					toBlock?: string;
				},
			) => {
				try {
					const fromRaw = options.fromBlock;
					const toRaw = options.toBlock;
					if (!fromRaw || !toRaw) {
						error("--from-block and --to-block are required");
						process.exit(1);
					}
					const fromBlock = Number.parseInt(fromRaw, 10);
					const toBlock = Number.parseInt(toRaw, 10);

					if (Number.isNaN(fromBlock) || Number.isNaN(toBlock)) {
						error("--from-block and --to-block must be valid block numbers");
						process.exit(1);
					}

					info(
						`Backfilling subgraph "${name}" from block ${fromBlock} to ${toBlock}...`,
					);

					const result = await backfillSubgraphApi(name, {
						fromBlock,
						toBlock,
					});

					success(result.message);
					info(`From block ${result.fromBlock} to ${result.toBlock}`);
				} catch (err) {
					handleApiError(err, "backfill subgraph");
				}
			},
		);

	// --- stop ---
	subgraphs
		.command("cancel <name>")
		.description("Cancel a running reindex or backfill operation")
		.action(async (name: string) => {
			try {
				info(`Stopping operation for subgraph "${name}"...`);
				const result = await stopSubgraphApi(name);
				success(result.message);
			} catch (err) {
				handleApiError(err, "stop subgraph operation");
			}
		});

	// --- gaps ---
	subgraphs
		.command("gaps <name>")
		.description("Show block gaps for a subgraph")
		.option("--resolved", "Include resolved gaps")
		.option("--limit <n>", "Max gaps to return", "50")
		.option("--json", "Output as JSON")
		.action(
			async (
				name: string,
				options: { resolved?: boolean; limit?: string; json?: boolean },
			) => {
				try {
					const result = await getSubgraphGaps(name, {
						limit: Number.parseInt(options.limit ?? "50", 10),
						resolved: options.resolved,
					});

					if (options.json) {
						console.log(JSON.stringify(result, null, 2));
						return;
					}

					if (result.data.length === 0) {
						success("No gaps detected");
						return;
					}

					const rows = result.data.map((g) => [
						String(g.start),
						String(g.end),
						String(g.size),
						g.reason,
						g.detectedAt.replace("T", " ").slice(0, 19),
						g.resolvedAt
							? g.resolvedAt.replace("T", " ").slice(0, 19)
							: dim("—"),
					]);

					console.log(
						formatTable(
							["Start", "End", "Size", "Reason", "Detected", "Resolved"],
							rows,
						),
					);

					console.log(
						dim(
							`\n${result.meta.total} gap(s), ${result.meta.totalMissingBlocks} total missing blocks`,
						),
					);
				} catch (err) {
					handleApiError(err, "get subgraph gaps");
				}
			},
		);

	// --- query ---
	subgraphs
		.command("query <name> <table>")
		.description("Query a subgraph table")
		.option("--sort <column>", "Sort by column")
		.option("--order <dir>", "Sort direction (asc|desc)", "asc")
		.option("--limit <n>", "Max rows to return", "20")
		.option("--offset <n>", "Skip first N rows")
		.option("--fields <cols>", "Comma-separated columns to include")
		.option(
			"--filter <kv...>",
			"Filter as key=value (supports .gte/.lte/.gt/.lt/.neq suffixes)",
		)
		.option("--count", "Return row count only")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ sl subgraphs query my-graph balances --filter holder=SP2J6ZY... --limit 50
  $ sl subgraphs query my-graph transfers --filter amount.gte=1000 --sort _block_height --order desc
  $ sl subgraphs query my-graph balances --count`,
		)
		.action(
			async (
				name: string,
				table: string,
				options: {
					sort?: string;
					order: string;
					limit: string;
					offset?: string;
					fields?: string;
					filter?: string[];
					count?: boolean;
					json?: boolean;
				},
			) => {
				try {
					let filters: Record<string, string> | undefined;
					try {
						filters = parseQueryFilters(options.filter);
					} catch (err) {
						error(err instanceof Error ? err.message : String(err));
						process.exit(1);
					}

					const params: SubgraphQueryParams = {
						sort: options.sort,
						order: options.sort ? options.order : undefined,
						limit: Number.parseInt(options.limit, 10),
						offset: options.offset
							? Number.parseInt(options.offset, 10)
							: undefined,
						fields: options.fields,
						filters,
					};

					if (options.count) {
						const result = await querySubgraphTableCount(name, table, params);
						if (options.json) {
							console.log(JSON.stringify(result, null, 2));
						} else {
							console.log(result.count);
						}
						return;
					}

					const rows = (await querySubgraphTable(
						name,
						table,
						params,
					)) as Record<string, unknown>[];

					if (options.json) {
						console.log(JSON.stringify(rows, null, 2));
						return;
					}

					if (rows.length === 0) {
						console.log(dim("No rows found"));
						return;
					}

					const firstRow = rows[0];
					if (!firstRow) return;
					const columns = Object.keys(firstRow);
					const tableRows = rows.map((row) =>
						columns.map((col) => {
							const val = row[col];
							if (val === null || val === undefined) return dim("-");
							if (typeof val === "object") return JSON.stringify(val);
							return String(val);
						}),
					);

					console.log(formatTable(columns, tableRows));
					console.log(dim(`\n${rows.length} row(s)`));
				} catch (err) {
					handleApiError(err, "query subgraph");
				}
			},
		);

	// --- delete ---
	subgraphs
		.command("delete <name>")
		.alias("rm")
		.description("Delete a subgraph and its data")
		.option("-y, --yes", "Skip confirmation")
		.option("--force", "Cancel active operations and force delete")
		.action(
			async (name: string, options: { yes?: boolean; force?: boolean }) => {
				try {
					if (!options.yes && !options.force) {
						// Refuse to prompt on non-TTY stdin. An empty pipe (`echo |`)
						// would otherwise feed a newline into confirm() and auto-accept
						// the destructive default.
						if (!process.stdin.isTTY) {
							error(
								"Interactive prompt unavailable (stdin is not a TTY). Re-run with -y to skip confirmation.",
							);
							process.exit(1);
						}
						const { confirm } = await import("@inquirer/prompts");
						let ok = false;
						try {
							ok = await confirm({
								message: `Delete subgraph "${name}" and all its data? This cannot be undone.`,
							});
						} catch (promptErr) {
							const m =
								promptErr instanceof Error
									? promptErr.message
									: String(promptErr);
							if (m.includes("ExitPromptError") || m.includes("force closed")) {
								error(
									"Interactive prompt unavailable. Re-run with -y to skip confirmation.",
								);
								process.exit(1);
							}
							throw promptErr;
						}
						if (!ok) {
							info("Cancelled");
							return;
						}
					}

					try {
						const result = await deleteSubgraphApi(name, {
							force: options.force,
						});
						success(result.message);
					} catch (delErr) {
						const msg =
							delErr instanceof Error ? delErr.message : String(delErr);
						const status = (delErr as { status?: number } | undefined)?.status;
						if (status === 404 || /not found/i.test(msg)) {
							info(`Subgraph "${name}" not found (already deleted?)`);
							return;
						}
						throw delErr;
					}
				} catch (err) {
					handleApiError(err, "delete subgraph");
				}
			},
		);

	// --- publish / unpublish ---
	subgraphs
		.command("publish <name>")
		.description(
			"Make a subgraph publicly readable on /v1/subgraphs/<name> (claims the name globally, no key needed to read)",
		)
		.action(async (name: string) => {
			try {
				await requireAuth();
				const result = await publishSubgraphApi(name);
				success(`Subgraph "${name}" is now public`);
				try {
					const { apiUrl } = await resolveAuth();
					info(`  Share: ${apiUrl}${result.url} (no key needed)`);
				} catch {}
			} catch (err) {
				const status = (err as { status?: number } | undefined)?.status;
				if (status === 409) {
					error(
						`Public name "${name}" is already taken by another account. Rename the subgraph (redeploy under a new name) or keep it private.`,
					);
					process.exit(1);
				}
				handleApiError(err, "publish subgraph");
			}
		});

	subgraphs
		.command("unpublish <name>")
		.description(
			"Make a subgraph private again — reads require your API key, the public name claim is released",
		)
		.action(async (name: string) => {
			try {
				await requireAuth();
				await unpublishSubgraphApi(name);
				success(`Subgraph "${name}" is now private (reads need your key)`);
			} catch (err) {
				handleApiError(err, "unpublish subgraph");
			}
		});

	// --- scaffold ---
	subgraphs
		.command("scaffold [contractAddress]")
		.description("Scaffold a defineSubgraph() file from a contract or trait")
		.option("-o, --output <path>", "Output file path (required)")
		.option("-k, --api-key <key>", "Stacks node API key for direct RPC URLs")
		.option(
			"--functions <names>",
			"Comma-separated public functions to index as typed contract_call tables",
		)
		.option(
			"--trait <std>",
			"Scaffold a trait-scoped source (sip-009|sip-010|sip-013) — no contract needed",
		)
		.option("--no-install", "Skip bun install after writing package.json")
		.addHelpText(
			"after",
			`
Examples:
  $ sl subgraphs scaffold SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.megapont-ape-club-nft -o subgraphs/apes.ts
  $ sl subgraphs scaffold SP00...token --functions transfer,mint -o subgraphs/token.ts
  $ sl subgraphs scaffold --trait sip-010 -o subgraphs/all-ft.ts`,
		)
		.action(
			async (
				contractAddress: string | undefined,
				options: {
					output?: string;
					apiKey?: string;
					functions?: string;
					trait?: string;
					install?: boolean;
				},
			) => {
				try {
					if (!options.output) {
						error("--output <path> is required");
						process.exit(1);
					}
					const trait = options.trait as
						| (typeof TRAIT_STANDARDS)[number]
						| undefined;
					if (
						trait &&
						!(TRAIT_STANDARDS as readonly string[]).includes(trait)
					) {
						error(`--trait must be one of: ${TRAIT_STANDARDS.join(", ")}`);
						process.exit(1);
					}
					if (!trait && !contractAddress) {
						error("a <contractAddress> is required (or use --trait)");
						process.exit(1);
					}

					const outPath = resolve(options.output);

					let content: string;
					if (trait) {
						// Trait mode — no contract to fetch.
						info(`Generating trait-scoped scaffold for ${trait}...`);
						content = await generateSubgraphScaffold({ trait });
					} else {
						const address = contractAddress as string;
						const network = inferNetwork(address) ?? "mainnet";
						const apiKey = options.apiKey ?? process.env.STACKS_NODE_API_KEY;
						const client = new StacksApiClient(network, apiKey);
						info(
							`Fetching ABI for ${address} via ${client.describeContractInfoSource()}...`,
						);
						const contractInfo = await client.getContractInfo(address);
						const abi = parseApiResponse(contractInfo);
						info("Generating scaffold...");
						content = await generateSubgraphScaffold({
							contractId: address,
							abi,
							functions: options.functions
								?.split(",")
								.map((f) => f.trim())
								.filter(Boolean),
						});
					}

					const dir = resolve(outPath, "..");
					if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
					await writeTextFile(outPath, content);
					ensureScaffoldPackageJson(dir);

					success(`Created ${outPath}`);
					if (options.install === false) {
						info(`Run: cd ${dir} && bun install`);
					} else {
						info("Installing dependencies with bun install...");
						try {
							await installScaffoldDependencies(dir);
						} catch (err) {
							error(
								`Dependency install failed: ${err instanceof Error ? err.message : String(err)}`,
							);
							info(`Run: cd ${dir} && bun install`);
							process.exit(1);
						}
					}
					info(`Next: sl subgraphs deploy ${options.output}`);
				} catch (err) {
					error(`Failed to scaffold subgraph: ${err}`);
					process.exit(1);
				}
			},
		);

	// --- client ---
	subgraphs
		.command("client <subgraphName>")
		.description("Generate a typed query client for a deployed subgraph")
		.option("-o, --output <path>", "Output file path (required)")
		.action(async (subgraphName: string, options: { output?: string }) => {
			try {
				if (!options.output) {
					error("--output <path> is required");
					process.exit(1);
				}

				const outPath = resolve(options.output);

				info(`Fetching subgraph metadata for "${subgraphName}"...`);
				const subgraphDetail = await getSubgraphApi(subgraphName);

				info("Generating typed client...");
				const content = await generateSubgraphConsumer(
					subgraphName,
					subgraphDetail,
				);

				const dir = resolve(outPath, "..");
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
				await writeTextFile(outPath, content);

				success(`Created ${outPath}`);
			} catch (err) {
				handleApiError(err, "generate subgraph client");
			}
		});
}
