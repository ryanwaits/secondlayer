import type { Command } from "commander";
import {
	type Config,
	clearConfig,
	getConfigPath,
	getDataDir,
	getDefaultConfig,
	isDefaultValue,
	loadConfig,
	resetConfig,
	setConfigValue,
} from "../lib/config.ts";
import { detectStacksNodes } from "../lib/detect.ts";
import {
	blue,
	dim,
	error,
	green,
	note,
	success,
	warn,
	writeData,
} from "../lib/output.ts";

export function registerConfigCommand(program: Command): void {
	const config = program
		.command("config")
		.description("Manage CLI configuration");

	config
		.command("get")
		.alias("show")
		.description("Show current configuration")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const cfg = await loadConfig();
				if (options.json) {
					writeData(JSON.stringify(cfg, null, 2));
					return;
				}
				note(`Config file: ${getConfigPath()}`);
				console.log("");
				await printConfigTree(cfg);
			} catch (err) {
				error(`Failed to load config: ${err}`);
				process.exit(1);
			}
		});

	config
		.command("set <key> <value>")
		.description("Set a configuration value (supports dot notation: ports.api)")
		.option(
			"--no-validate",
			"Skip connection validation for database/redis URLs",
		)
		.addHelpText(
			"after",
			`
Examples:
  $ sl config set network local
  $ sl config set ports.api 3800
  $ sl config set database.url postgres://localhost:5432/secondlayer_dev`,
		)
		.action(
			async (key: string, value: string, options: { validate: boolean }) => {
				try {
					await setConfigValue(key, value);
					success(`Set ${key} = ${value}`);

					// Validate connection for database.url and redis.url
					if (options.validate) {
						if (key === "database.url") {
							await validateDatabaseConnection(value);
						}
					}
				} catch (err) {
					if (err instanceof Error && err.message.includes("Invalid")) {
						error(`Invalid value for ${key}: ${err.message}`);
					} else {
						error(`Failed to set config: ${err}`);
					}
					process.exit(1);
				}
			},
		);

	config
		.command("reset")
		.description("Reset configuration to defaults")
		.option("-y, --yes", "Skip confirmation")
		.action(async (opts: { yes?: boolean }) => {
			try {
				if (
					!opts.yes &&
					!(await confirmDestructive("Reset configuration to defaults?"))
				) {
					return;
				}
				await resetConfig();
				success("Configuration reset to defaults");
			} catch (err) {
				error(`Failed to reset config: ${err}`);
				process.exit(1);
			}
		});

	config
		.command("delete")
		.alias("clear")
		.description("Delete all configuration (remove the config file)")
		.option("-y, --yes", "Skip confirmation")
		.action(async (opts: { yes?: boolean }) => {
			try {
				if (
					!opts.yes &&
					!(await confirmDestructive("Delete the config file?"))
				) {
					return;
				}
				await clearConfig();
				success("Configuration cleared");
			} catch (err) {
				error(`Failed to clear config: ${err}`);
				process.exit(1);
			}
		});
}

async function confirmDestructive(message: string): Promise<boolean> {
	if (!process.stdin.isTTY) {
		error(
			"Interactive prompt unavailable (stdin is not a TTY). Re-run with -y to skip confirmation.",
		);
		process.exit(1);
	}
	const { confirm } = await import("@inquirer/prompts");
	try {
		const ok = await confirm({ message, default: false });
		if (!ok) console.log("Cancelled.");
		return ok;
	} catch (promptErr) {
		const m =
			promptErr instanceof Error ? promptErr.message : String(promptErr);
		if (m.includes("ExitPromptError") || m.includes("force closed")) {
			error(
				"Interactive prompt unavailable. Re-run with -y to skip confirmation.",
			);
			process.exit(1);
		}
		throw promptErr;
	}
}

async function printConfigTree(cfg: Config): Promise<void> {
	const defaults = getDefaultConfig();

	// Network + default project
	printValue("network", cfg.network, isDefaultValue(cfg, "network"));
	if (cfg.defaultProject) {
		printValue("defaultProject", cfg.defaultProject, false);
	}

	// Data Directory
	const resolvedDataDir = getDataDir(cfg);
	const dataDirDisplay =
		cfg.dataDir === resolvedDataDir
			? cfg.dataDir
			: `${cfg.dataDir} ${dim(`→ ${resolvedDataDir}`)}`;
	printValue("dataDir", dataDirDisplay, isDefaultValue(cfg, "dataDir"));

	// Local-only sections
	if (cfg.network === "local") {
		// Node
		console.log("");
		console.log(blue("node:"));
		if (cfg.node) {
			printValue("  installPath", cfg.node.installPath, false, 2);
			printValue(
				"  network",
				cfg.node.network,
				cfg.node.network === "mainnet",
				2,
			);
		} else {
			console.log(dim("  (not configured)"));
			// Show detected nodes hint (requires Bun/docker — skip silently on Node)
			try {
				const detected = await detectStacksNodes();
				if (detected.length > 0) {
					console.log("");
					console.log(
						dim(
							`  Detected ${detected.length} node${detected.length > 1 ? "s" : ""}:`,
						),
					);
					for (const node of detected.slice(0, 3)) {
						const status = node.running ? green("●") : dim("○");
						console.log(dim(`    ${status} ${node.path} (${node.network})`));
					}
					console.log(dim("  Run 'sl init' to configure"));
				}
			} catch {}
		}

		// Ports
		console.log("");
		console.log(blue("ports:"));
		printValue("  api", cfg.ports.api, cfg.ports.api === defaults.ports.api, 2);
		printValue(
			"  indexer",
			cfg.ports.indexer,
			cfg.ports.indexer === defaults.ports.indexer,
			2,
		);

		// Database
		console.log("");
		console.log(blue("database:"));
		printValue("  type", cfg.database.type, cfg.database.type === "docker", 2);
		if (cfg.database.url) {
			printValue("  url", maskUrl(cfg.database.url), false, 2);
		}
	}

	console.log("");
}

function printValue(
	key: string,
	value: unknown,
	isDefault: boolean,
	_indent = 0,
): void {
	const valueStr = String(value);
	const defaultIndicator = isDefault ? dim(" (default)") : "";
	const valueColor = isDefault ? dim(valueStr) : green(valueStr);
	console.log(`${key}: ${valueColor}${defaultIndicator}`);
}

function maskUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) {
			parsed.password = "****";
		}
		return parsed.toString();
	} catch {
		return url;
	}
}

/**
 * Validate PostgreSQL connection
 */
async function validateDatabaseConnection(url: string): Promise<void> {
	try {
		// Dynamic import to avoid hard dependency on postgres package
		const { default: postgres } = await import("postgres" as string);
		const sql = postgres(url);
		await sql`SELECT 1`;
		await sql.end();
		success("Database connection verified");
	} catch (err) {
		warn(
			`Could not connect to database: ${err instanceof Error ? err.message : err}`,
		);
		console.log(
			dim(
				"The URL was saved but connection failed. Check your database settings.",
			),
		);
	}
}
