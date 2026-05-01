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
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import type { Command } from "commander";
import { generateSubgraphScaffold } from "../generators/subgraph-scaffold.ts";
import { generateSubgraphConsumer } from "../generators/subgraphs.ts";
import {
	backfillSubgraphApi,
	deleteSubgraphApi,
	deploySubgraphApi,
	getSubgraphApi,
	getSubgraphGaps,
	handleApiError,
	listSubgraphsApi,
	querySubgraphTable,
	querySubgraphTableCount,
	reindexSubgraphApi,
	stopSubgraphApi,
} from "../lib/api-client.ts";
import type { SubgraphQueryParams } from "../lib/api-client.ts";
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
import { parseApiResponse } from "../parsers/clarity.ts";
import { generateSubgraphTemplate } from "../templates/subgraph.ts";
import { StacksApiClient } from "../utils/api.ts";
import { inferNetwork } from "../utils/network.ts";

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
		.command("new <name>")
		.description("Scaffold a new subgraph definition file")
		.action(async (name: string) => {
			const dir = resolve("subgraphs");
			const filePath = resolve(dir, `${name}.ts`);

			if (existsSync(filePath)) {
				error(`File already exists: ${filePath}`);
				process.exit(1);
			}

			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			const content = generateSubgraphTemplate(name);
			await writeTextFile(filePath, content);

			success(`Created ${filePath}`);
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
		.description("Deploy a subgraph definition file")
		.option(
			"--version <semver>",
			"Explicit version (default: auto-increment patch)",
		)
		.option(
			"--start-block <n>",
			"Override the subgraph definition startBlock for this deploy",
		)
		.option("--dry-run", "Validate and preview deploy without writing changes")
		.option("--preview", "Alias for --dry-run")
		.option("--force", "Skip confirmation prompt for reindex operations")
		.action(
			async (
				file: string,
				options: {
					version?: string;
					startBlock?: string;
					dryRun?: boolean;
					preview?: boolean;
					force?: boolean;
				},
			) => {
				try {
					const absPath = resolve(file);
					const config = await loadConfig();
					const dryRun = options.dryRun || options.preview;
					const startBlock = parseStartBlockOption(options.startBlock);
					if (startBlock !== undefined) {
						warn(
							`--start-block ${startBlock} overrides the definition's startBlock for this deploy.`,
						);
					}

					// Load and validate locally for fast feedback
					info(`Loading subgraph from ${absPath}`);
					const mod = await import(absPath);
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
										version: options.version ?? validated.version,
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
						const result = await deploySubgraphApi({
							name: effectiveDef.name,
							version: options.version,
							description: effectiveDef.description,
							sources: effectiveDef.sources as Record<
								string,
								Record<string, unknown>
							>,
							schema: effectiveDef.schema,
							handlerCode,
							sourceCode: source,
							...(startBlock !== undefined ? { startBlock } : {}),
						});

						if (result.action === "unchanged") {
							info(
								`Subgraph "${effectiveDef.name}" is up to date (v${result.version} — no changes)`,
							);
						} else if (result.action === "created") {
							// Fresh deploy — no existing data to drop, no confirmation needed
							success(
								`Subgraph "${effectiveDef.name}" created → v${result.version}`,
							);
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

							// Confirmation prompt — dropping existing data (skippable with --force)
							const confirmed =
								options.force ||
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
						}
					} else {
						// ── Local deploy ───────────────────────────────────────
						if (dryRun) {
							printSubgraphDeployPreview(
								createSubgraphDeployPreview({
									...validated,
									version: options.version ?? validated.version,
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
							version: options.version,
							forceReindex: startBlock !== undefined,
						});

						if (result.action === "unchanged") {
							info(
								`Subgraph "${effectiveDef.name}" is up to date (v${result.version} — no changes)`,
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
		.description("Show detailed subgraph status")
		.action(async (name: string) => {
			try {
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
			} catch (err) {
				handleApiError(err, "get subgraph status");
			}
		});

	// --- reindex ---
	subgraphs
		.command("reindex <name>")
		.description("Reindex a subgraph from historical blocks")
		.option("--from <block>", "Start block height")
		.option("--to <block>", "End block height")
		.action(async (name: string, options: { from?: string; to?: string }) => {
			try {
				info(`Reindexing subgraph "${name}"...`);

				const result = await reindexSubgraphApi(name, {
					fromBlock: options.from
						? Number.parseInt(options.from, 10)
						: undefined,
					toBlock: options.to ? Number.parseInt(options.to, 10) : undefined,
				});

				success(result.message);
				info(`From block ${result.fromBlock} to ${result.toBlock}`);
			} catch (err) {
				handleApiError(err, "reindex subgraph");
			}
		});

	// --- backfill ---
	subgraphs
		.command("backfill <name>")
		.description("Backfill a block range without dropping existing data")
		.requiredOption("--from <block>", "Start block height")
		.requiredOption("--to <block>", "End block height")
		.action(async (name: string, options: { from: string; to: string }) => {
			try {
				const fromBlock = Number.parseInt(options.from, 10);
				const toBlock = Number.parseInt(options.to, 10);

				if (Number.isNaN(fromBlock) || Number.isNaN(toBlock)) {
					error("--from and --to must be valid block numbers");
					process.exit(1);
				}

				info(
					`Backfilling subgraph "${name}" from block ${fromBlock} to ${toBlock}...`,
				);

				const result = await backfillSubgraphApi(name, { fromBlock, toBlock });

				success(result.message);
				info(`From block ${result.fromBlock} to ${result.toBlock}`);
			} catch (err) {
				handleApiError(err, "backfill subgraph");
			}
		});

	// --- stop ---
	subgraphs
		.command("stop <name>")
		.description("Stop a running reindex or backfill operation")
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
		.description("Delete a subgraph and its data")
		.option("-y, --yes", "Skip confirmation")
		.option("--force", "Cancel active operations and force delete")
		.action(
			async (name: string, options: { yes?: boolean; force?: boolean }) => {
				try {
					if (!options.yes && !options.force) {
						const { confirm } = await import("@inquirer/prompts");
						const ok = await confirm({
							message: `Delete subgraph "${name}" and all its data? This cannot be undone.`,
						});
						if (!ok) {
							info("Cancelled");
							return;
						}
					}

					const result = await deleteSubgraphApi(name, {
						force: options.force,
					});
					success(result.message);
				} catch (err) {
					handleApiError(err, "delete subgraph");
				}
			},
		);

	// --- scaffold ---
	subgraphs
		.command("scaffold <contractAddress>")
		.description("Scaffold a defineSubgraph() file from a contract ABI")
		.option("-o, --output <path>", "Output file path (required)")
		.option("--api-key <key>", "Stacks node API key for direct RPC URLs")
		.option("--no-install", "Skip bun install after writing package.json")
		.action(
			async (
				contractAddress: string,
				options: { output?: string; apiKey?: string; install?: boolean },
			) => {
				try {
					if (!options.output) {
						error("--output <path> is required");
						process.exit(1);
					}

					const outPath = resolve(options.output);
					const network = inferNetwork(contractAddress) ?? "mainnet";
					const apiKey =
						options.apiKey ??
						process.env.STACKS_NODE_API_KEY ??
						process.env.HIRO_API_KEY;

					const client = new StacksApiClient(network, apiKey);
					info(
						`Fetching ABI for ${contractAddress} via ${client.describeContractInfoSource()}...`,
					);
					const contractInfo = await client.getContractInfo(contractAddress);
					const abi = parseApiResponse(contractInfo);

					info("Generating scaffold...");
					const content = await generateSubgraphScaffold({
						contractId: contractAddress,
						functions: abi.functions,
					});

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

	// --- generate ---
	subgraphs
		.command("generate <subgraphName>")
		.description("Generate a typed client for a deployed subgraph")
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
