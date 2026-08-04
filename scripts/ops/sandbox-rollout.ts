#!/usr/bin/env bun
/**
 * Sandbox rollout — internal operator knob for the per-subgraph ROLLOUT
 * switch (`subgraphs.sandbox_workers`, migration 0109). NOT public CLI
 * surface: this is an off-by-default internal knob, not a customer-facing
 * feature, so it lives here rather than in `sl`.
 *
 * Two switches gate the sandboxed handler-execution path (see
 * packages/subgraphs/src/runtime/sandbox/flag.ts):
 *   - the global CAPABILITY switch (`SUBGRAPH_SANDBOX_WORKERS=1` env, set at
 *     deploy time — this script only REPORTS whether it's visible in this
 *     process's env, it never sets it);
 *   - the per-subgraph ROLLOUT switch (`subgraphs.sandbox_workers`) — this
 *     script is the only thing that flips it.
 * Both are required (AND, not OR) for a subgraph to actually run sandboxed.
 *
 * Usage:
 *   bun scripts/ops/sandbox-rollout.ts                  # report (default; no mutation)
 *   bun scripts/ops/sandbox-rollout.ts --enable <name>  [--yes]
 *   bun scripts/ops/sandbox-rollout.ts --disable <name> [--yes]
 *
 * `subgraphs` is a control-plane table (packages/shared/migrations/0075_...)
 * — under the source/target DB split it lives on TARGET, not SOURCE (see
 * packages/shared/src/db/migration-role.ts). Connects via
 * TARGET_DATABASE_URL, falling back to DATABASE_URL (single-DB dev/OSS).
 * Bun.SQL replaces pg/postgres.js per project stack convention.
 */

export interface SubgraphRow {
	name: string;
	sandbox_workers: boolean;
	status: string;
}

export function capabilityFlagVisible(): boolean {
	return process.env.SUBGRAPH_SANDBOX_WORKERS === "1";
}

/** Pure formatter — no DB access — so report shape is testable without
 *  spawning the script. */
export function formatReport(
	rows: SubgraphRow[],
	capabilityOn: boolean,
): string {
	const lines: string[] = [
		`global capability flag (SUBGRAPH_SANDBOX_WORKERS): ${
			capabilityOn ? "1 (on, visible in this process's env)" : "unset (off)"
		}`,
	];
	if (rows.length === 0) {
		lines.push("no subgraphs found");
		return lines.join("\n");
	}
	for (const row of rows) {
		lines.push(
			`${row.name}\tsandbox_workers=${row.sandbox_workers}\tstatus=${row.status}`,
		);
	}
	return lines.join("\n");
}

export async function fetchSubgraphs(db: Bun.SQL): Promise<SubgraphRow[]> {
	const rows = await db`
		SELECT name, sandbox_workers, status FROM subgraphs ORDER BY name
	`;
	return rows as unknown as SubgraphRow[];
}

async function findSubgraph(
	db: Bun.SQL,
	name: string,
): Promise<SubgraphRow | null> {
	const rows = await db`
		SELECT name, sandbox_workers, status FROM subgraphs WHERE name = ${name}
	`;
	return (rows as unknown as SubgraphRow[])[0] ?? null;
}

async function setSandboxWorkers(
	db: Bun.SQL,
	name: string,
	value: boolean,
): Promise<void> {
	await db`
		UPDATE subgraphs SET sandbox_workers = ${value} WHERE name = ${name}
	`;
}

function rollbackCommand(name: string, wasEnabled: boolean): string {
	// `wasEnabled` = the value just written; rollback restores the opposite.
	return wasEnabled
		? `bun scripts/ops/sandbox-rollout.ts --disable ${name} --yes`
		: `bun scripts/ops/sandbox-rollout.ts --enable ${name} --yes`;
}

async function main(): Promise<void> {
	const DB_URL =
		process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || "";
	if (!DB_URL) {
		console.error(
			"sandbox-rollout: no database connection configured — set TARGET_DATABASE_URL or DATABASE_URL.",
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	const enableIdx = args.indexOf("--enable");
	const disableIdx = args.indexOf("--disable");
	const yes = args.includes("--yes");

	if (enableIdx !== -1 && disableIdx !== -1) {
		console.error("sandbox-rollout: pass only one of --enable / --disable.");
		process.exit(1);
	}

	const db = new Bun.SQL(DB_URL);
	try {
		if (enableIdx === -1 && disableIdx === -1) {
			const rows = await fetchSubgraphs(db);
			console.log(formatReport(rows, capabilityFlagVisible()));
			return;
		}

		const enabling = enableIdx !== -1;
		const flagIdx = enabling ? enableIdx : disableIdx;
		const name = args[flagIdx + 1];
		if (!name || name.startsWith("--")) {
			console.error(
				`sandbox-rollout: --${enabling ? "enable" : "disable"} requires a subgraph name.`,
			);
			process.exit(1);
		}

		const row = await findSubgraph(db, name);
		if (!row) {
			console.error(
				`sandbox-rollout: no subgraph named "${name}" found. Refusing.`,
			);
			process.exit(1);
		}

		const before = row.sandbox_workers;
		const after = enabling;
		if (before === after) {
			console.log(
				`sandbox-rollout: ${name} sandbox_workers is already ${after} — nothing to do.`,
			);
			return;
		}

		console.log(`${name}: sandbox_workers ${before} -> ${after}`);
		if (!yes) {
			if (!process.stdin.isTTY) {
				console.error(
					"sandbox-rollout: interactive prompt unavailable (stdin is not a TTY). Re-run with --yes to skip confirmation.",
				);
				process.exit(1);
			}
			const { confirm } = await import("@inquirer/prompts");
			let confirmed = false;
			try {
				confirmed = await confirm({
					message: `${enabling ? "Enable" : "Disable"} sandbox workers for "${name}"?`,
					default: false,
				});
			} catch (promptErr) {
				const m =
					promptErr instanceof Error ? promptErr.message : String(promptErr);
				if (m.includes("ExitPromptError") || m.includes("force closed")) {
					console.error(
						"sandbox-rollout: interactive prompt unavailable. Re-run with --yes to skip confirmation.",
					);
					process.exit(1);
				}
				throw promptErr;
			}
			if (!confirmed) {
				console.log("Aborted.");
				return;
			}
		}

		await setSandboxWorkers(db, name, after);
		console.log(`sandbox-rollout: ${name} sandbox_workers set to ${after}.`);
		console.log(`Rollback: ${rollbackCommand(name, after)}`);
	} finally {
		await db.close();
	}
}

if (import.meta.main) {
	await main();
}
