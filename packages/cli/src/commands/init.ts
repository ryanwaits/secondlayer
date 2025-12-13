import { promises as fs } from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";

/**
 * Init command - creates a default config file
 */

export async function init() {
  const spinner = ora("Initializing").start();
  const configPath = path.join(process.cwd(), "stacks.config.ts");

  // Check if config already exists
  try {
    await fs.access(configPath);
    spinner.warn("stacks.config.ts already exists");
    return;
  } catch {
    // File doesn't exist, continue
  }

  // Check for Clarinet project
  const hasClarinetProject = await fileExists("./Clarinet.toml");

  let config: string;

  if (hasClarinetProject) {
    // Generate plugin-based config for Clarinet projects
    config = `import { defineConfig } from '@secondlayer/cli';
import { clarinet } from '@secondlayer/cli/plugins';

export default defineConfig({
  out: './src/generated/contracts.ts',
  plugins: [
    clarinet() // Found Clarinet.toml in current directory
  ]
});`;
  } else {
    // Generate basic config for non-Clarinet projects
    config = `import { defineConfig } from '@secondlayer/cli';

export default defineConfig({
  out: './src/generated/contracts.ts',
  plugins: [],
});`;
  }

  // Write config file
  await fs.writeFile(configPath, config);

  spinner.succeed("Created `stacks.config.ts`");

  console.log(
    "\nRun `secondlayer generate` to generate type-safe interfaces, functions, and hooks!"
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
