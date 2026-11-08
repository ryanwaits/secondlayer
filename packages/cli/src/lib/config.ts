import { join } from "node:path";
import { z } from "zod";
import {
	ensureDir,
	fileExists,
	readJsonFile,
	removeFile,
	writeTextFile,
} from "./fs.ts";
import { secondlayerDir } from "./home.ts";

export const NetworkSchema = z.enum(["local", "testnet", "mainnet"]);
export type Network = z.infer<typeof NetworkSchema>;

export const ConfigSchema = z.object({
	network: NetworkSchema.default("mainnet"),
});

export type Config = z.infer<typeof ConfigSchema>;

const configPath = () => join(secondlayerDir(), "config.json");

const DEFAULT_CONFIG: Config = { network: "mainnet" };

async function ensureConfigDir(): Promise<void> {
	await ensureDir(secondlayerDir());
}

/**
 * Load config from disk. Unknown fields in older files are dropped.
 * Also applies the STACKS_NETWORK override.
 */
export async function loadConfig(): Promise<Config> {
	let config: Config;

	if (!(await fileExists(configPath()))) {
		config = { ...DEFAULT_CONFIG };
	} else {
		try {
			const raw = await readJsonFile<unknown>(configPath());
			config = ConfigSchema.parse(raw);
		} catch (error) {
			// If validation fails, return defaults
			console.error("Warning: Invalid config file, using defaults");
			config = { ...DEFAULT_CONFIG };
		}
	}

	// Apply environment variable overrides (from .env or shell)
	config = applyEnvOverrides(config);

	return config;
}

/**
 * Apply environment variable overrides to config
 */
function applyEnvOverrides(config: Config): Config {
	const result = { ...config };

	// STACKS_NETWORK. The CLI's vocabulary is mainnet|testnet|devnet; this
	// config file predates it and still spells the local network "local", so
	// devnet maps onto it. Anything else is named once on stderr instead of
	// being dropped silently and leaving the command on the mainnet default.
	if (process.env.STACKS_NETWORK) {
		const net = process.env.STACKS_NETWORK;
		if (net === "local" || net === "testnet" || net === "mainnet") {
			result.network = net;
		} else if (net === "devnet") {
			result.network = "local";
		} else {
			console.error(
				`Warning: STACKS_NETWORK=${net} is not mainnet, testnet, or devnet; using ${result.network}`,
			);
		}
	}

	return result;
}

/**
 * Save config to disk after validation
 */
export async function saveConfig(config: Config): Promise<void> {
	// Validate before saving
	const validated = ConfigSchema.parse(config);
	await ensureConfigDir();
	await writeTextFile(configPath(), `${JSON.stringify(validated, null, 2)}\n`);
}

/**
 * Set a config value. Unknown keys are rejected rather than dropped by the
 * schema, so `config set` never reports a write it did not make.
 */
export async function setConfigValue(
	key: string,
	value: string,
): Promise<void> {
	if (!(key in ConfigSchema.shape)) {
		throw new Error(`Invalid config key: ${key}`);
	}
	const config = await loadConfig();
	await saveConfig({ ...config, [key]: value } as Config);
}

/**
 * Reset config to defaults
 */
export async function resetConfig(): Promise<void> {
	await saveConfig({ ...DEFAULT_CONFIG });
}

/**
 * Clear config file entirely
 */
export async function clearConfig(): Promise<void> {
	if (await fileExists(configPath())) {
		await removeFile(configPath());
	}
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
	return configPath();
}

/**
 * Get default config
 */
export function getDefaultConfig(): Config {
	return { ...DEFAULT_CONFIG };
}

/**
 * Exit with message if not in local mode. Use at top of local-only commands.
 */
export async function requireLocalNetwork(): Promise<Config> {
	const config = await loadConfig();
	if (config.network !== "local") {
		console.error("Error: this command requires local mode.");
		console.error(`  Current context: ${config.network} (hosted)`);
		console.error("");
		console.error("  To check system status, use: secondlayer status");
		console.error("");
		console.error(
			"  To switch to local mode: secondlayer config set network local",
		);
		process.exit(1);
	}
	return config;
}
