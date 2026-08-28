/**
 * `secondlayer uninstall` — stop the stack, keep what cannot be rebuilt.
 *
 * Dry-run by default, like every other destructive command here. The purge
 * path is gated twice (explicit confirmation AND a keys backup) because it is
 * the only one that can lose something no archive can restore.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { planUninstall, uninstallCommand } from "@secondlayer/shared/runtime";
import type { Command } from "commander";
import { readEnvValue } from "../lib/instance-init.ts";
import { note, output, printError, success, warn } from "../lib/output.ts";

export const UNINSTALL_EXIT = { OK: 0, FAILED: 1, REFUSED: 2 } as const;

/** The monorepo checkout's compose file, for a stack brought up by hand. */
const REPO_COMPOSE = "docker/oss/docker-compose.yml";

/** A bundle counts only if it actually carries keys. */
function bundleHasKeys(bundleDir: string): boolean {
	const manifest = join(bundleDir, "manifest.json");
	if (!existsSync(manifest)) return false;
	try {
		const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
			secrets?: unknown;
		};
		return parsed.secrets != null;
	} catch {
		return false;
	}
}

export interface UninstallLayout {
	composeFile: string;
	/** Passed to `docker compose --env-file` so the same interpolated values
	 *  (volume names, ports) that brought the stack up also take it down. */
	envFile?: string;
	/** Which env file, if any, holds the keys: the one carrying
	 *  `SECONDLAYER_SECRETS_KEY`, else the first env file that exists. */
	secretsFile?: string;
}

/**
 * Where this stack lives. `secondlayer setup` writes `docker-compose.yml` +
 * `.env` into its target directory; a hand-run checkout uses the repo's
 * compose file and `secondlayer init`'s `.env.local`. Both are checked for
 * secrets so a setup directory can never purge past the keys guard just
 * because the guard only knew the other layout.
 */
export function resolveUninstallLayout(
	dir: string,
	composeOverride?: string,
): UninstallLayout {
	const setupCompose = resolve(dir, "docker-compose.yml");
	const setupEnv = resolve(dir, ".env");
	const initEnv = resolve(dir, ".env.local");
	// Any env file counts as keys present, not only one that holds the
	// secrets key: a purge that guesses wrong here destroys the volumes, so
	// a hand-written `.env.local` gets the same refusal as a generated one.
	const secretsFile =
		[setupEnv, initEnv].find(
			(file) => readEnvValue(file, "SECONDLAYER_SECRETS_KEY") !== null,
		) ?? [setupEnv, initEnv].find((file) => existsSync(file));
	if (composeOverride) {
		const composeFile = resolve(dir, composeOverride);
		const sibling = resolve(composeFile, "..", ".env");
		return {
			composeFile,
			envFile: existsSync(sibling) ? sibling : undefined,
			secretsFile,
		};
	}
	if (existsSync(setupCompose)) {
		return {
			composeFile: setupCompose,
			envFile: existsSync(setupEnv) ? setupEnv : undefined,
			secretsFile,
		};
	}
	return { composeFile: resolve(dir, REPO_COMPOSE), secretsFile };
}

/** `uninstallCommand` from shared plus the `--env-file` compose needs to
 *  resolve the same project name and volumes it was started with. */
export function composeDownArgs(
	plan: Parameters<typeof uninstallCommand>[0],
	layout: UninstallLayout,
): string[] {
	const base = uninstallCommand(plan, layout.composeFile);
	if (!layout.envFile) return base;
	const fileFlagEnd = base.indexOf("-f") + 2;
	return [
		...base.slice(0, fileFlagEnd),
		"--env-file",
		layout.envFile,
		...base.slice(fileFlagEnd),
	];
}

export function registerUninstallCommand(program: Command): void {
	program
		.command("uninstall")
		.description("Stop the stack; the index, chainstate, and keys survive")
		.option(
			"--compose <file>",
			`compose file to tear down (default: ./docker-compose.yml from setup, else ${REPO_COMPOSE})`,
		)
		.option("--purge", "also destroy the volumes (wipes the index)")
		.option("--yes", "confirm a purge")
		.option(
			"--backup <dir>",
			"a bundle proving the keys exist elsewhere (required to purge)",
		)
		.option("--apply", "actually run it (default is a dry run)")
		.option("--json", "Output as JSON")
		.action(
			async (opts: {
				compose?: string;
				purge?: boolean;
				yes?: boolean;
				backup?: string;
				apply?: boolean;
				json?: boolean;
			}) => {
				const dataDir = process.env.DATA_DIR ?? "./data";
				const layout = resolveUninstallLayout(process.cwd(), opts.compose);
				const secretsPresent =
					!!process.env.SECONDLAYER_SECRETS_KEY || !!layout.secretsFile;
				const keysBackedUp = opts.backup
					? bundleHasKeys(resolve(opts.backup))
					: false;

				const decision = planUninstall({
					purge: opts.purge === true,
					confirmed: opts.yes === true,
					keysBackedUp,
					secretsPresent,
					dataDir,
				});

				if (!decision.ok) {
					printError(decision.reason, {
						hint: layout.secretsFile
							? `keys found in ${layout.secretsFile}`
							: undefined,
					});
					process.exit(UNINSTALL_EXIT.REFUSED);
				}

				const cmd = composeDownArgs(decision.plan, layout);

				if (!opts.apply) {
					output({
						json: opts.json,
						data: {
							dryRun: true,
							plan: decision.plan,
							command: cmd,
							composeFile: layout.composeFile,
							envFile: layout.envFile ?? null,
							secretsFile: layout.secretsFile ?? null,
						},
						human: () => {
							note("dry run — nothing removed. Pass --apply to proceed.");
							note(`compose: ${layout.composeFile}`);
							if (layout.envFile) note(`env: ${layout.envFile}`);
							if (layout.secretsFile) note(`keys: ${layout.secretsFile}`);
							note(`would run: docker ${cmd.join(" ")}`);
							for (const p of decision.plan.preserves) {
								note(`preserved · ${p.what}: ${p.detail}`);
							}
							for (const d of decision.plan.destroys) {
								warn(`DESTROYED · volume ${d}`);
							}
						},
					});
					return;
				}

				const res = spawnSync("docker", cmd, { stdio: "inherit" });
				if ((res.status ?? 1) !== 0) {
					printError(`docker ${cmd.join(" ")} exited ${res.status}`);
					process.exit(UNINSTALL_EXIT.FAILED);
				}

				output({
					json: opts.json,
					data: {
						removed: true,
						plan: decision.plan,
						composeFile: layout.composeFile,
						envFile: layout.envFile ?? null,
					},
					human: () => {
						success("stack removed");
						for (const w of decision.warnings) warn(w);
						for (const p of decision.plan.preserves) {
							note(`preserved · ${p.what}: ${p.detail}`);
						}
					},
				});
			},
		);
}
