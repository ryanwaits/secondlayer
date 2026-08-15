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
import { note, output, printError, success, warn } from "../lib/output.ts";

export const UNINSTALL_EXIT = { OK: 0, FAILED: 1, REFUSED: 2 } as const;

const DEFAULT_COMPOSE = "docker/oss/docker-compose.yml";

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

export function registerUninstallCommand(program: Command): void {
	program
		.command("uninstall")
		.description("Stop the stack; the index, chainstate, and keys survive")
		.option("--compose <file>", "compose file to tear down", DEFAULT_COMPOSE)
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
				compose: string;
				purge?: boolean;
				yes?: boolean;
				backup?: string;
				apply?: boolean;
				json?: boolean;
			}) => {
				const dataDir = process.env.DATA_DIR ?? "./data";
				const secretsPresent =
					!!process.env.SECONDLAYER_SECRETS_KEY ||
					existsSync(resolve(process.cwd(), ".env.local"));
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
					printError(decision.reason);
					process.exit(UNINSTALL_EXIT.REFUSED);
				}

				const cmd = uninstallCommand(decision.plan, opts.compose);

				if (!opts.apply) {
					output({
						json: opts.json,
						data: { dryRun: true, plan: decision.plan, command: cmd },
						human: () => {
							note("dry run — nothing removed. Pass --apply to proceed.");
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
					data: { removed: true, plan: decision.plan },
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
