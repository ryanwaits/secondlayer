import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Config schema with Zod validation
const PortsSchema = z.object({
  api: z.number().int().min(1).max(65535).default(3800),
  indexer: z.number().int().min(1).max(65535).default(3700),
  webhook: z.number().int().min(1).max(65535).default(3900),
});

const NodeSchema = z.object({
  installPath: z.string().min(1),
  network: z.enum(["mainnet", "testnet"]).default("mainnet"),
});

const DatabaseSchema = z.object({
  type: z.enum(["docker", "external"]).default("docker"),
  url: z.string().url().optional(),
});

export const NetworkSchema = z.enum(["local", "testnet", "mainnet"]);
export type Network = z.infer<typeof NetworkSchema>;

const API_URLS: Record<Network, string> = {
  local: "http://localhost:3800",
  testnet: "https://api.secondlayer.tools",
  mainnet: "https://api.secondlayer.tools",
};

export const ConfigSchema = z.object({
  network: NetworkSchema.default("mainnet"),
  apiUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  sessionToken: z.string().optional(),
  dataDir: z.string().default("~/.secondlayer/data"),
  defaultWebhookUrl: z.string().url().optional(),
  node: NodeSchema.optional(),
  ports: PortsSchema.default({}),
  database: DatabaseSchema.default({}),
});

/**
 * Resolve the API URL for the current network.
 * Explicit apiUrl in config takes precedence, then network-based lookup.
 */
export function resolveApiUrl(config: Config): string {
  if (config.apiUrl) return config.apiUrl;
  return API_URLS[config.network] || API_URLS.local;
}

export type Config = z.infer<typeof ConfigSchema>;
export type NodeConfig = z.infer<typeof NodeSchema>;
export type PortsConfig = z.infer<typeof PortsSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseSchema>;

const CONFIG_DIR = join(homedir(), ".secondlayer");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const LOCAL_WEBHOOK_URL = "http://localhost:3900/webhook";

const DEFAULT_CONFIG: Config = {
  network: "mainnet",
  dataDir: "~/.secondlayer/data",
  ports: { api: 3800, indexer: 3700, webhook: 3900 },
  database: { type: "docker" },
};

async function ensureConfigDir(): Promise<void> {
  await Bun.$`mkdir -p ${CONFIG_DIR}`.quiet();
}

/**
 * Resolve ~ to home directory in paths
 */
export function resolvePath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Get the resolved data directory path
 */
export function getDataDir(config?: Config): string {
  const dataDir = config?.dataDir ?? DEFAULT_CONFIG.dataDir;
  return resolvePath(dataDir);
}

/**
 * Migrate old config format to new format
 */
function migrateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CONFIG };
  }

  const old = raw as Record<string, unknown>;

  // Start with defaults
  const migrated: Record<string, unknown> = { ...DEFAULT_CONFIG };

  // Migrate network + apiKey
  if (typeof old.network === "string" && ["local", "testnet", "mainnet"].includes(old.network)) {
    migrated.network = old.network;
  } else if (typeof old.apiUrl === "string" && old.apiUrl !== "http://localhost:3800") {
    // Old config with custom apiUrl but no network — keep as local with explicit apiUrl
    migrated.network = "local";
  }

  if (typeof old.apiKey === "string") {
    migrated.apiKey = old.apiKey;
  }

  if (typeof old.sessionToken === "string") {
    migrated.sessionToken = old.sessionToken;
  }

  // Preserve explicit apiUrl override
  if (typeof old.apiUrl === "string" && old.apiUrl !== "http://localhost:3800") {
    migrated.apiUrl = old.apiUrl;
  }

  if (typeof old.dataDir === "string") {
    migrated.dataDir = old.dataDir;
  }

  if (typeof old.defaultWebhookUrl === "string") {
    migrated.defaultWebhookUrl = old.defaultWebhookUrl;
  }

  // Migrate old flat node fields to nested structure
  if (typeof old.nodeInstallPath === "string" || typeof old.nodeNetwork === "string") {
    migrated.node = {
      installPath: old.nodeInstallPath as string || "",
      network: (old.nodeNetwork as "mainnet" | "testnet") || "mainnet",
    };
    // Only include node if installPath is set
    if (!(migrated.node as { installPath: string }).installPath) {
      delete migrated.node;
    }
  }

  // Preserve nested structures if they exist
  if (old.node && typeof old.node === "object") {
    migrated.node = old.node;
  }

  if (old.ports && typeof old.ports === "object") {
    migrated.ports = { ...DEFAULT_CONFIG.ports, ...(old.ports as object) };
  }

  if (old.database && typeof old.database === "object") {
    migrated.database = { ...DEFAULT_CONFIG.database, ...(old.database as object) };
  }

  // Migrate old indexerPort to ports.indexer
  if (typeof old.indexerPort === "number") {
    (migrated.ports as PortsConfig).indexer = old.indexerPort;
  }

  return migrated as Config;
}

/**
 * Load config from disk, migrating old formats and validating
 * Also applies environment variable overrides from .env
 */
export async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_PATH);
  let config: Config;

  if (!(await file.exists())) {
    config = { ...DEFAULT_CONFIG };
  } else {
    try {
      const raw = await file.json();
      const migrated = migrateConfig(raw);
      config = ConfigSchema.parse(migrated);
    } catch (error) {
      // If validation fails, return defaults
      console.error("Warning: Invalid config file, using defaults");
      config = { ...DEFAULT_CONFIG };
    }
  }

  // Apply environment variable overrides (from .env or shell)
  config = applyEnvOverrides(config);

  // Default webhook URL only for local network
  if (!config.defaultWebhookUrl && config.network === "local") {
    config.defaultWebhookUrl = LOCAL_WEBHOOK_URL;
  }

  return config;
}

/**
 * Apply environment variable overrides to config
 * Supports: SL_DATA_DIR, SL_API_PORT, DATABASE_URL
 */
function applyEnvOverrides(config: Config): Config {
  const result = { ...config };

  // STACKS_NETWORK
  if (process.env.STACKS_NETWORK) {
    const net = process.env.STACKS_NETWORK;
    if (net === "local" || net === "testnet" || net === "mainnet") {
      result.network = net;
    }
  }

  // SECONDLAYER_API_KEY
  if (process.env.SECONDLAYER_API_KEY) {
    result.apiKey = process.env.SECONDLAYER_API_KEY;
  }

  // SECONDLAYER_SESSION_TOKEN
  if (process.env.SECONDLAYER_SESSION_TOKEN) {
    result.sessionToken = process.env.SECONDLAYER_SESSION_TOKEN;
  }

  // SL_DATA_DIR
  if (process.env.SL_DATA_DIR) {
    result.dataDir = process.env.SL_DATA_DIR;
  }

  // SL_API_PORT
  if (process.env.SL_API_PORT) {
    const port = parseInt(process.env.SL_API_PORT, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      result.ports = { ...result.ports, api: port };
    }
  }

  // SL_INDEXER_PORT
  if (process.env.SL_INDEXER_PORT) {
    const port = parseInt(process.env.SL_INDEXER_PORT, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      result.ports = { ...result.ports, indexer: port };
    }
  }

  // SL_WEBHOOK_PORT
  if (process.env.SL_WEBHOOK_PORT) {
    const port = parseInt(process.env.SL_WEBHOOK_PORT, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      result.ports = { ...result.ports, webhook: port };
    }
  }

  // DATABASE_URL - implies external database
  if (process.env.DATABASE_URL) {
    result.database = { type: "external", url: process.env.DATABASE_URL };
  }

  return result;
}

/**
 * Check if a config file exists
 */
export async function configExists(): Promise<boolean> {
  return await Bun.file(CONFIG_PATH).exists();
}

/**
 * Save config to disk after validation
 */
export async function saveConfig(config: Config): Promise<void> {
  // Validate before saving
  const validated = ConfigSchema.parse(config);
  await ensureConfigDir();
  await Bun.write(CONFIG_PATH, JSON.stringify(validated, null, 2) + "\n");
}

/**
 * Set a nested config value using dot notation
 * e.g., setConfigValue("ports.api", 4000)
 */
export async function setConfigValue(key: string, value: unknown): Promise<void> {
  const config = await loadConfig();
  const keys = key.split(".");

  // Navigate to parent and set value
  let current: Record<string, unknown> = config as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (current[k] === undefined) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1]!;

  // Parse value to appropriate type
  const parsedValue = parseValue(value);
  current[finalKey] = parsedValue;

  // Validate the complete config before saving
  await saveConfig(config);
}

/**
 * Parse string value to appropriate type
 */
function parseValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") {
    return num;
  }

  // String
  return value;
}

/**
 * Get a nested config value using dot notation
 */
export function getConfigValue(config: Config, key: string): unknown {
  const keys = key.split(".");
  let current: unknown = config;

  for (const k of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[k];
  }

  return current;
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
  const file = Bun.file(CONFIG_PATH);
  if (await file.exists()) {
    await Bun.$`rm ${CONFIG_PATH}`.quiet();
  }
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Get default config
 */
export function getDefaultConfig(): Config {
  return { ...DEFAULT_CONFIG };
}

/**
 * Check if a config value differs from the default
 */
/**
 * Exit with message if not in local mode. Use at top of local-only commands.
 */
export async function requireLocalNetwork(): Promise<Config> {
  const config = await loadConfig();
  if (config.network !== "local") {
    console.error(`Error: 'sl local' commands require local mode.`);
    console.error(`  Current context: ${config.network} (hosted)`);
    console.error("");
    console.error(`  To view stream logs, use: sl logs <stream>`);
    console.error(`  To check system status, use: sl status`);
    console.error("");
    console.error(`  To switch to local mode: sl config set network local`);
    process.exit(1);
  }
  return config;
}

export function isDefaultValue(config: Config, key: string): boolean {
  const currentValue = getConfigValue(config, key);
  const defaultValue = getConfigValue(DEFAULT_CONFIG, key);
  return JSON.stringify(currentValue) === JSON.stringify(defaultValue);
}
