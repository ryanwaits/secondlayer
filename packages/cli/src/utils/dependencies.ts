import { promises as fs } from "fs";
import path from "path";
import { detect } from "@antfu/ni";
import { execa } from "execa";
import chalk from "chalk";

/**
 * Required dependencies for base generated contracts
 */
export const BASE_DEPENDENCIES = {
  dependencies: ["@secondlayer/stacks"],
  devDependencies: [] as string[],
} as const;

/**
 * Required dependencies for React hooks
 */
export const HOOKS_DEPENDENCIES = {
  dependencies: [
    "react",
    "@tanstack/react-query",
    "@secondlayer/stacks",
  ],
  devDependencies: ["@types/react"],
} as const;

/**
 * Get the package manager used in the project
 */
export async function getPackageManager(
  targetDir: string
): Promise<"yarn" | "pnpm" | "bun" | "npm"> {
  const packageManager = await detect({ programmatic: true, cwd: targetDir });

  if (packageManager === "yarn@berry") return "yarn";
  if (packageManager === "pnpm@6") return "pnpm";
  if (packageManager === "bun") return "bun";
  if (packageManager === "deno") return "npm"; // Fallback to npm for deno

  return packageManager ?? "npm";
}

/**
 * Check if a package.json exists in the target directory
 */
export async function hasPackageJson(targetDir: string): Promise<boolean> {
  try {
    const packageJsonPath = path.join(targetDir, "package.json");
    await fs.access(packageJsonPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse package.json
 */
export async function readPackageJson(targetDir: string): Promise<any> {
  const packageJsonPath = path.join(targetDir, "package.json");
  const content = await fs.readFile(packageJsonPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Check which dependencies are missing from a required list
 */
export async function getMissingDependenciesFor(
  targetDir: string,
  requiredDeps: { dependencies: readonly string[]; devDependencies: readonly string[] }
): Promise<{
  dependencies: string[];
  devDependencies: string[];
}> {
  if (!(await hasPackageJson(targetDir))) {
    // If no package.json, all dependencies are missing
    return {
      dependencies: [...requiredDeps.dependencies],
      devDependencies: [...requiredDeps.devDependencies],
    };
  }

  const packageJson = await readPackageJson(targetDir);
  const existingDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const missingDeps = requiredDeps.dependencies.filter(
    (dep) => !existingDeps[dep]
  );

  const missingDevDeps = requiredDeps.devDependencies.filter(
    (dep) => !existingDeps[dep]
  );

  return {
    dependencies: missingDeps,
    devDependencies: missingDevDeps,
  };
}

/**
 * Check which dependencies are missing (for hooks - backwards compatible)
 */
export async function getMissingDependencies(targetDir: string): Promise<{
  dependencies: string[];
  devDependencies: string[];
}> {
  return getMissingDependenciesFor(targetDir, HOOKS_DEPENDENCIES);
}

/**
 * Check if @secondlayer/stacks is installed and warn if not
 */
export async function checkBaseDependencies(targetDir: string): Promise<void> {
  const missing = await getMissingDependenciesFor(targetDir, BASE_DEPENDENCIES);

  if (missing.dependencies.length > 0) {
    console.log(chalk.yellow("\n⚠ Required peer dependency not found: @secondlayer/stacks"));
    console.log(chalk.gray("  The generated code requires @secondlayer/stacks to work."));
    console.log(chalk.gray("  Install it with:"));

    const packageManager = await getPackageManager(targetDir);
    const installCmd = packageManager === "npm" ? "install" : "add";
    console.log(chalk.cyan(`    ${packageManager} ${installCmd} @secondlayer/stacks\n`));
  }
}

/**
 * Install missing dependencies
 */
export async function installDependencies(
  targetDir: string,
  dependencies: string[],
  devDependencies: string[] = []
): Promise<void> {
  const packageManager = await getPackageManager(targetDir);

  // Install regular dependencies
  if (dependencies.length > 0) {
    console.log(chalk.gray(`  Installing dependencies: ${dependencies.join(", ")}`));

    try {
      const installCmd = packageManager === "npm" ? "install" : "add";
      await execa(packageManager, [installCmd, ...dependencies], {
        cwd: targetDir,
      });
      console.log(chalk.green(`✓ Installed dependencies: ${dependencies.join(", ")}`));
    } catch (error) {
      console.error(chalk.red("✗ Failed to install dependencies"));
      throw error;
    }
  }

  // Install dev dependencies
  if (devDependencies.length > 0) {
    console.log(chalk.gray(`  Installing dev dependencies: ${devDependencies.join(", ")}`));

    try {
      let installCmd: string[];
      switch (packageManager) {
        case "npm":
          installCmd = ["install", "--save-dev"];
          break;
        case "yarn":
          installCmd = ["add", "--dev"];
          break;
        case "pnpm":
          installCmd = ["add", "--save-dev"];
          break;
        case "bun":
          installCmd = ["add", "--dev"];
          break;
        default:
          installCmd = ["install", "--save-dev"];
      }

      await execa(packageManager, [...installCmd, ...devDependencies], {
        cwd: targetDir,
      });
      console.log(chalk.green(`✓ Installed dev dependencies: ${devDependencies.join(", ")}`));
    } catch (error) {
      console.error(chalk.red("✗ Failed to install dev dependencies"));
      throw error;
    }
  }
}

/**
 * Check and install missing dependencies for hooks
 */
export async function ensureHooksDependencies(
  targetDir: string
): Promise<void> {
  const missing = await getMissingDependencies(targetDir);

  if (
    missing.dependencies.length === 0 &&
    missing.devDependencies.length === 0
  ) {
    console.log(
      chalk.green("✓ All required dependencies are already installed")
    );
    return;
  }

  console.log(
    chalk.yellow("\n📦 Installing missing dependencies for React hooks...")
  );

  if (missing.dependencies.length > 0) {
    console.log(
      chalk.gray(`Missing dependencies: ${missing.dependencies.join(", ")}`)
    );
  }

  if (missing.devDependencies.length > 0) {
    console.log(
      chalk.gray(
        `Missing dev dependencies: ${missing.devDependencies.join(", ")}`
      )
    );
  }

  await installDependencies(
    targetDir,
    missing.dependencies,
    missing.devDependencies
  );
}
