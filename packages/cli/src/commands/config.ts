import type { Command } from "commander";
import {
	type Config,
	clearConfig,
	getConfigPath,
	getDefaultConfig,
	loadConfig,
	resetConfig,
	setConfigValue,
} from "../lib/config.ts";
import {
	confirmDestructive,
	dim,
	error,
	green,
	info,
	note,
	success,
	writeData,
} from "../lib/output.ts";

export function registerConfigCommand(program: Command): void {
	const config = program
		.command("config")
		.description("Manage CLI configuration");

	config
		.command("get")
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
				printConfig(cfg);
			} catch (err) {
				error(`Failed to load config: ${err}`);
				process.exit(1);
			}
		});

	config
		.command("set <key> <value>")
		.description("Set a configuration value")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer config set network local`,
		)
		.action(async (key: string, value: string) => {
			try {
				await setConfigValue(key, value);
				success(`Set ${key} = ${value}`);
			} catch (err) {
				if (err instanceof Error && err.message.includes("Invalid")) {
					error(`Invalid value for ${key}: ${err.message}`);
				} else {
					error(`Failed to set config: ${err}`);
				}
				process.exit(1);
			}
		});

	config
		.command("reset")
		.description("Reset configuration to defaults")
		.option("-y, --yes", "Skip confirmation")
		.action(async (opts: { yes?: boolean }) => {
			try {
				if (
					!(await confirmDestructive({
						message: "Reset configuration to defaults?",
						yes: opts.yes,
					}))
				) {
					info("Cancelled.");
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
		.description("Delete all configuration (remove the config file)")
		.option("-y, --yes", "Skip confirmation")
		.action(async (opts: { yes?: boolean }) => {
			try {
				if (
					!(await confirmDestructive({
						message: "Delete the config file?",
						yes: opts.yes,
					}))
				) {
					info("Cancelled.");
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

function printConfig(cfg: Config): void {
	const isDefault = cfg.network === getDefaultConfig().network;
	const value = isDefault ? dim(cfg.network) : green(cfg.network);
	console.log(`network: ${value}${isDefault ? dim(" (default)") : ""}`);
	console.log("");
}
