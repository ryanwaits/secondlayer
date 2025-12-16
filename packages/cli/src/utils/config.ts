import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";
import type { StacksConfig, ConfigDefiner } from "../types/config";
import type { ResolvedConfig } from "../types/plugin";
import { PluginManager } from "../core/plugin-manager";

/**
 * Config file utilities
 */

const CONFIG_FILE_NAMES = [
  "stacks.config.ts",
  "stacks.config",
  "stacks.config.mjs",
];

export async function findConfigFile(cwd: string): Promise<string | null> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = path.join(cwd, fileName);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // File doesn't exist, continue
    }
  }
  return null;
}

export async function loadConfig(configPath?: string): Promise<ResolvedConfig> {
  const cwd = process.cwd();

  const resolvedPath = configPath
    ? path.resolve(cwd, configPath)
    : await findConfigFile(cwd);

  if (!resolvedPath) {
    throw new Error(
      "No config file found. Create a stacks.config.ts file or specify a path with --config"
    );
  }

  let config: any;

  if (resolvedPath.endsWith(".ts")) {
    const code = await fs.readFile(resolvedPath, "utf-8");

    // Transform TypeScript to JavaScript, replacing the @secondlayer/cli import
    // For development/linked packages, we need to resolve to the actual package location
    // This will work both for published packages and local development
    let replacementPath: string;

    try {
      // Try to resolve @secondlayer/cli as if it were a normal package
      const require = createRequire(import.meta.url);
      const packagePath = require.resolve("@secondlayer/cli");
      replacementPath = pathToFileURL(packagePath).href;
    } catch {
      // Fallback: resolve relative to current module (for development)
      const currentModuleDir = path.dirname(new URL(import.meta.url).pathname);
      const indexPath = path.resolve(currentModuleDir, "../index");
      replacementPath = pathToFileURL(indexPath).href;
    }

    const transformedCode = code.replace(
      /from\s+["']@secondlayer\/cli["']/g,
      `from '${replacementPath}'`
    );

    const { transformSync } = await import("esbuild");
    const result = transformSync(transformedCode, {
      format: "esm",
      target: "node18",
      loader: "ts",
    });

    const tempPath = resolvedPath.replace(/\.ts$/, ".mjs");
    await fs.writeFile(tempPath, result.code);

    try {
      const fileUrl = pathToFileURL(tempPath).href;
      const module = await import(fileUrl);
      config = module.default;
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  } else {
    const fileUrl = pathToFileURL(resolvedPath).href;
    const module = await import(fileUrl);
    config = module.default;
  }

  if (!config) {
    throw new Error("Config file must export a default configuration");
  }

  if (typeof config === "function") {
    config = config({} as StacksConfig);
  }

  validateConfig(config);

  // Process plugins if they exist
  const pluginManager = new PluginManager();

  if (config.plugins && Array.isArray(config.plugins)) {
    for (const plugin of config.plugins) {
      pluginManager.register(plugin);
    }
  }

  // Transform config through plugins
  const resolvedConfig = await pluginManager.transformConfig(config);

  return resolvedConfig;
}

export function validateConfig(
  config: unknown
): asserts config is StacksConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Config must be an object");
  }

  const c = config as any;

  // Contracts are optional now since plugins can provide them
  if (c.contracts && !Array.isArray(c.contracts)) {
    throw new Error("Config contracts must be an array");
  }

  if (!c.out || typeof c.out !== "string") {
    throw new Error("Config out must be a string path");
  }

  // Validate contracts if they exist
  if (c.contracts) {
    for (const contract of c.contracts) {
      if (!contract.address && !contract.source) {
        throw new Error("Each contract must have either an address or source");
      }
    }
  }

  // Validate plugins if they exist
  if (c.plugins && !Array.isArray(c.plugins)) {
    throw new Error("Config plugins must be an array");
  }
}

export function defineConfig(config: StacksConfig): StacksConfig;
export function defineConfig(definer: ConfigDefiner): ConfigDefiner;
export function defineConfig(configOrDefiner: StacksConfig | ConfigDefiner) {
  return configOrDefiner;
}
