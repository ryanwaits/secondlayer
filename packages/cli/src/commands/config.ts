import { Command } from "commander";
import {
  loadConfig,
  setConfigValue,
  clearConfig,
  resetConfig,
  getConfigPath,
  getDataDir,
  getDefaultConfig,
  isDefaultValue,
  resolveApiUrl,
  type Config,
} from "../lib/config.ts";
import { detectStacksNodes } from "../lib/detect.ts";
import { success, error, warn, dim, blue, green } from "../lib/output.ts";

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Manage CLI configuration");

  config
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      try {
        const cfg = await loadConfig();
        console.log(dim(`Config file: ${getConfigPath()}`));
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
    .option("--no-validate", "Skip connection validation for database/redis URLs")
    .action(async (key: string, value: string, options: { validate: boolean }) => {
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
    });

  config
    .command("reset")
    .description("Reset configuration to defaults")
    .action(async () => {
      try {
        await resetConfig();
        success("Configuration reset to defaults");
      } catch (err) {
        error(`Failed to reset config: ${err}`);
        process.exit(1);
      }
    });

  config
    .command("clear")
    .description("Clear all configuration (delete config file)")
    .action(async () => {
      try {
        await clearConfig();
        success("Configuration cleared");
      } catch (err) {
        error(`Failed to clear config: ${err}`);
        process.exit(1);
      }
    });
}

async function printConfigTree(cfg: Config): Promise<void> {
  const defaults = getDefaultConfig();

  // Network + API URL
  printValue("network", cfg.network, isDefaultValue(cfg, "network"));
  printValue("apiUrl", resolveApiUrl(cfg), cfg.apiUrl === undefined);
  if (cfg.apiKey) {
    printValue("apiKey", cfg.apiKey.slice(0, 14) + "...", false);
  }

  // Data Directory
  const resolvedDataDir = getDataDir(cfg);
  const dataDirDisplay = cfg.dataDir === resolvedDataDir
    ? cfg.dataDir
    : `${cfg.dataDir} ${dim(`→ ${resolvedDataDir}`)}`;
  printValue("dataDir", dataDirDisplay, isDefaultValue(cfg, "dataDir"));

  // Node
  console.log("");
  console.log(blue("node:"));
  if (cfg.node) {
    printValue("  installPath", cfg.node.installPath, false, 2);
    printValue("  network", cfg.node.network, cfg.node.network === "mainnet", 2);
  } else {
    console.log(dim("  (not configured)"));
    // Show detected nodes hint
    const detected = await detectStacksNodes();
    if (detected.length > 0) {
      console.log("");
      console.log(dim(`  Detected ${detected.length} node${detected.length > 1 ? "s" : ""}:`));
      for (const node of detected.slice(0, 3)) {
        const status = node.running ? green("●") : dim("○");
        console.log(dim(`    ${status} ${node.path} (${node.network})`));
      }
      console.log(dim("  Run 'sl init' to configure"));
    }
  }

  // Ports
  console.log("");
  console.log(blue("ports:"));
  printValue("  api", cfg.ports.api, cfg.ports.api === defaults.ports.api, 2);
  printValue("  indexer", cfg.ports.indexer, cfg.ports.indexer === defaults.ports.indexer, 2);
  printValue("  webhook", cfg.ports.webhook, cfg.ports.webhook === defaults.ports.webhook, 2);

  // Database
  console.log("");
  console.log(blue("database:"));
  printValue("  type", cfg.database.type, cfg.database.type === "docker", 2);
  if (cfg.database.url) {
    printValue("  url", maskUrl(cfg.database.url), false, 2);
  }

  console.log("");
}

function printValue(key: string, value: unknown, isDefault: boolean, _indent = 0): void {
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
    warn(`Could not connect to database: ${err instanceof Error ? err.message : err}`);
    console.log(dim("The URL was saved but connection failed. Check your database settings."));
  }
}

