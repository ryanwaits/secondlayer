import type { Database } from "bun:sqlite";
import type { AgentConfig } from "../config.ts";
import { NEVER_RESTART, WARN_RESTART } from "../config.ts";
import { insertDecision } from "../db/queries.ts";
import { checkCooldown, recordCooldown } from "../db/queries.ts";
import type { ActionType, PatternMatch } from "../types.ts";

interface ExecuteResult {
	outcome: string;
	detail: string;
}

function log(msg: string): void {
	console.log(`[${new Date().toISOString()}] [executor] ${msg}`);
}

export class ActionExecutor {
	constructor(
		private config: AgentConfig,
		private db: Database,
	) {}

	async execute(
		action: ActionType,
		service: string,
		context: PatternMatch,
	): Promise<ExecuteResult> {
		// Log decision
		const tier = "t1_auto";

		// Safety checks
		if (action === "restart_service") {
			if ((NEVER_RESTART as readonly string[]).includes(service)) {
				const result = {
					outcome: "blocked",
					detail: `${service} is in NEVER_RESTART list`,
				};
				insertDecision(this.db, {
					tier,
					trigger: context.name,
					analysis: context.message,
					action,
					service,
					outcome: result.outcome,
					costUsd: 0,
				});
				log(`BLOCKED: restart ${service} — ${result.detail}`);
				return result;
			}

			if ((WARN_RESTART as readonly string[]).includes(service)) {
				const result = {
					outcome: "alert_only",
					detail: `${service} is in WARN_RESTART list — alerting instead`,
				};
				insertDecision(this.db, {
					tier,
					trigger: context.name,
					analysis: context.message,
					action: "alert_only",
					service,
					outcome: result.outcome,
					costUsd: 0,
				});
				log(`WARN: ${service} restart requested but deferred to alert`);
				return result;
			}

			if (
				checkCooldown(
					this.db,
					service,
					"restart_service",
					this.config.maxRestartsPerHour,
				)
			) {
				const result = {
					outcome: "cooldown",
					detail: `${service} restart rate limited (max ${this.config.maxRestartsPerHour}/hr)`,
				};
				insertDecision(this.db, {
					tier,
					trigger: context.name,
					analysis: context.message,
					action,
					service,
					outcome: result.outcome,
					costUsd: 0,
				});
				log(`COOLDOWN: ${result.detail}`);
				return result;
			}
		}

		// Dry run
		if (this.config.dryRun) {
			const result = {
				outcome: "dry_run",
				detail: `Would execute ${action} on ${service}`,
			};
			insertDecision(this.db, {
				tier,
				trigger: context.name,
				analysis: context.message,
				action,
				service,
				outcome: result.outcome,
				costUsd: 0,
			});
			log(`DRY RUN: ${result.detail}`);
			return result;
		}

		// Execute action
		let result: ExecuteResult;
		switch (action) {
			case "restart_service":
				result = await this.restartService(service);
				recordCooldown(this.db, service, "restart_service");
				break;
			case "vacuum_postgres":
				result = await this.vacuumPostgres();
				break;
			case "prune_docker":
				result = await this.pruneDocker();
				break;
			case "clear_docker_logs":
				result = await this.clearDockerLogs(service);
				break;
			case "alert_only":
			case "escalate":
			case "none":
				result = {
					outcome: action,
					detail: `No automated action for ${action}`,
				};
				break;
			default:
				result = { outcome: "unknown", detail: `Unknown action: ${action}` };
		}

		insertDecision(this.db, {
			tier,
			trigger: context.name,
			analysis: context.message,
			action,
			service,
			outcome: result.outcome,
			costUsd: 0,
		});
		log(`${action} on ${service}: ${result.outcome} — ${result.detail}`);
		return result;
	}

	private async restartService(service: string): Promise<ExecuteResult> {
		const svcName = this.resolveServiceName(service);
		const result = Bun.spawnSync([
			...this.config.composeCmd,
			"restart",
			svcName,
		]);
		const stderr = result.stderr.toString();

		if (result.exitCode === 0) {
			return { outcome: "success", detail: `Restarted ${svcName}` };
		}
		return { outcome: "failed", detail: `Restart failed: ${stderr}` };
	}

	private async vacuumPostgres(): Promise<ExecuteResult> {
		const result = Bun.spawnSync([
			"docker",
			"exec",
			"secondlayer-postgres-1",
			"psql",
			"-U",
			"secondlayer",
			"-c",
			"VACUUM ANALYZE;",
		]);

		if (result.exitCode === 0) {
			return { outcome: "success", detail: "VACUUM ANALYZE completed" };
		}
		return { outcome: "failed", detail: result.stderr.toString() };
	}

	private async pruneDocker(): Promise<ExecuteResult> {
		// Pre-check: note running container count. Doesn't block — `docker
		// system prune -f` is safe against live containers (only removes
		// stopped/dangling), but a 0 count means something's already wrong
		// and the prune should still proceed. Logged into the outcome so
		// we can correlate post-incident.
		const runningBefore = this.countRunningContainers();
		const diskBefore = this.readDiskAvailBytes();

		const result = Bun.spawnSync(["docker", "system", "prune", "-f"]);
		if (result.exitCode !== 0) {
			return { outcome: "failed", detail: result.stderr.toString() };
		}

		// Post-check: compute freed space so the decision record captures
		// whether the prune actually helped. If delta is ~0, the disk
		// pressure was driven by something prune can't touch (real data
		// growth, chainstate) — future signal for the Haiku analyzer.
		const diskAfter = this.readDiskAvailBytes();
		const freedBytes =
			diskBefore != null && diskAfter != null
				? Math.max(0, diskAfter - diskBefore)
				: null;

		const summary = [
			result.stdout.toString().trim(),
			`running_before=${runningBefore}`,
			freedBytes != null ? `freed_bytes=${freedBytes}` : null,
		]
			.filter(Boolean)
			.join(" | ");

		return { outcome: "success", detail: summary };
	}

	private countRunningContainers(): number | null {
		const r = Bun.spawnSync([
			"docker",
			"ps",
			"--filter",
			"status=running",
			"--quiet",
		]);
		if (r.exitCode !== 0) return null;
		const lines = r.stdout.toString().split("\n").filter(Boolean);
		return lines.length;
	}

	private readDiskAvailBytes(): number | null {
		// `df -B1 --output=avail /` → "Avail\n<bytes>\n"
		const r = Bun.spawnSync(["df", "-B1", "--output=avail", "/"]);
		if (r.exitCode !== 0) return null;
		const line = r.stdout.toString().split("\n")[1]?.trim();
		const n = line ? Number.parseInt(line, 10) : Number.NaN;
		return Number.isFinite(n) ? n : null;
	}

	private async clearDockerLogs(service: string): Promise<ExecuteResult> {
		// Find container log file path
		const container = this.resolveContainerName(service);
		const inspectResult = Bun.spawnSync([
			"docker",
			"inspect",
			"--format",
			"{{.LogPath}}",
			container,
		]);

		const logPath = inspectResult.stdout.toString().trim();
		if (!logPath) {
			return { outcome: "failed", detail: "Could not determine log path" };
		}

		const truncResult = Bun.spawnSync(["truncate", "-s", "0", logPath]);
		if (truncResult.exitCode === 0) {
			return { outcome: "success", detail: `Cleared logs for ${container}` };
		}
		return { outcome: "failed", detail: truncResult.stderr.toString() };
	}

	private resolveServiceName(service: string): string {
		// Strip "secondlayer-" prefix and "-1" suffix if present
		return service.replace(/^secondlayer-/, "").replace(/-\d+$/, "");
	}

	private resolveContainerName(service: string): string {
		const svc = this.config.services.find((s) => s.name === service);
		return svc?.container ?? `secondlayer-${service}-1`;
	}
}
