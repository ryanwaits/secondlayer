import { promises as fs } from "fs";
import path from "path";
import { detect } from "@antfu/ni";
import { execa } from "execa";
import ora from "ora";
import chalk from "chalk";

/**
 * Required dependencies for React hooks
 */
export const HOOKS_DEPENDENCIES = {
  dependencies: [
    "react",
    "@tanstack/react-query",
    "@stacks/transactions",
    "@stacks/connect",
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
 * Check which dependencies are missing
 */
export async function getMissingDependencies(targetDir: string): Promise<{
  dependencies: string[];
  devDependencies: string[];
}> {
  if (!(await hasPackageJson(targetDir))) {
    // If no package.json, all dependencies are missing
    return {
      dependencies: [...HOOKS_DEPENDENCIES.dependencies],
      devDependencies: [...HOOKS_DEPENDENCIES.devDependencies],
    };
  }

  const packageJson = await readPackageJson(targetDir);
  const existingDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const missingDeps = HOOKS_DEPENDENCIES.dependencies.filter(
    (dep) => !existingDeps[dep]
  );

  const missingDevDeps = HOOKS_DEPENDENCIES.devDependencies.filter(
    (dep) => !existingDeps[dep]
  );

  return {
    dependencies: missingDeps,
    devDependencies: missingDevDeps,
  };
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
    const depsSpinner = ora(
      `Installing dependencies: ${dependencies.join(", ")}`
    ).start();

    try {
      const installCmd = packageManager === "npm" ? "install" : "add";
      await execa(packageManager, [installCmd, ...dependencies], {
        cwd: targetDir,
      });
      depsSpinner.succeed(
        `Installed dependencies: ${chalk.green(dependencies.join(", "))}`
      );
    } catch (error) {
      depsSpinner.fail("Failed to install dependencies");
      throw error;
    }
  }

  // Install dev dependencies
  if (devDependencies.length > 0) {
    const devDepsSpinner = ora(
      `Installing dev dependencies: ${devDependencies.join(", ")}`
    ).start();

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
      devDepsSpinner.succeed(
        `Installed dev dependencies: ${chalk.green(devDependencies.join(", "))}`
      );
    } catch (error) {
      devDepsSpinner.fail("Failed to install dev dependencies");
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
