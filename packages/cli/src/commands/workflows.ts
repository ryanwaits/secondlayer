import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SecondLayer } from "@secondlayer/sdk";
import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import {
	dim,
	error,
	formatKeyValue,
	formatTable,
	green,
	info,
	success,
	yellow,
} from "../lib/output.ts";

function formatValidationError(err: unknown): void {
	if (
		err != null &&
		typeof err === "object" &&
		"issues" in err &&
		Array.isArray((err as Record<string, unknown>).issues)
	) {
		error("Workflow validation failed:");
		for (const issue of (
			err as { issues: Array<{ path?: string[]; message: string }> }
		).issues) {
			const path = issue.path?.length ? issue.path.join(".") : "(root)";
			error(`  ${path}: ${issue.message}`);
		}
	} else {
		error(`Failed to validate workflow: ${err}`);
	}
}

function getClient(): SecondLayer {
	const apiKey = process.env.SECONDLAYER_API_KEY;
	if (!apiKey) {
		error("SECONDLAYER_API_KEY required. Run: sl auth login");
		process.exit(1);
	}
	return new SecondLayer({ apiKey });
}

export function registerWorkflowsCommand(program: Command): void {
	const workflows = program
		.command("workflows")
		.description("Manage workflows");

	// --- deploy ---
	workflows
		.command("deploy <file>")
		.description("Validate and deploy a workflow definition file")
		.action(async (file: string) => {
			try {
				const absPath = resolve(file);
				if (!existsSync(absPath)) {
					error(`File not found: ${absPath}`);
					process.exit(1);
				}

				info(`Loading workflow from ${absPath}`);
				const mod = await import(absPath);
				const def = mod.default ?? mod;

				const { validateWorkflowDefinition } = await import(
					"@secondlayer/workflows/validate"
				);
				const result = validateWorkflowDefinition(def);

				const config = await loadConfig();

				if (config.network !== "local") {
					// ── Remote deploy ──────────────────────────────────────
					info(`Bundling for remote deploy (${config.network})...`);

					const esbuild = await import("esbuild");
					const buildResult = await esbuild.build({
						entryPoints: [absPath],
						bundle: true,
						platform: "node",
						format: "esm",
						external: ["@secondlayer/workflows"],
						write: false,
					});

					const handlerCode = new TextDecoder().decode(
						buildResult.outputFiles?.[0]?.contents,
					);

					const deployResult = await getClient().workflows.deploy({
						name: def.name,
						trigger: def.trigger,
						handlerCode,
						retries: def.retries,
						timeout: def.timeout,
					});

					if (deployResult.action === "unchanged") {
						info(`Workflow "${def.name}" is up to date (no changes)`);
					} else {
						success(`Workflow "${def.name}" ${deployResult.action} (remote)`);
					}
				} else {
					// ── Local deploy ───────────────────────────────────────
					success(`Workflow "${result.name}" is valid`);
					info(`Trigger: ${result.trigger.type}`);
					if (result.retries) {
						info(
							`Retries: maxAttempts=${result.retries.maxAttempts ?? "default"}`,
						);
					}
					if (result.timeout) {
						info(`Timeout: ${result.timeout}ms`);
					}
				}
			} catch (err) {
				formatValidationError(err);
				process.exit(1);
			}
		});

	// --- validate ---
	workflows
		.command("validate <file>")
		.description("Validate a workflow definition without deploying")
		.action(async (file: string) => {
			try {
				const absPath = resolve(file);
				if (!existsSync(absPath)) {
					error(`File not found: ${absPath}`);
					process.exit(1);
				}

				const mod = await import(absPath);
				const def = mod.default ?? mod;

				const { validateWorkflowDefinition } = await import(
					"@secondlayer/workflows/validate"
				);
				const result = validateWorkflowDefinition(def);

				success(`Workflow "${result.name}" is valid`);
				info(`Trigger: ${result.trigger.type}`);
				if (result.retries) {
					info(
						`Retries: maxAttempts=${result.retries.maxAttempts ?? "default"}, backoffMs=${result.retries.backoffMs ?? 1000}, multiplier=${result.retries.backoffMultiplier ?? 2}`,
					);
				}
				if (result.timeout) {
					info(`Timeout: ${result.timeout}ms`);
				}
			} catch (err) {
				formatValidationError(err);
				process.exit(1);
			}
		});

	// --- list ---
	workflows
		.command("list")
		.alias("ls")
		.description("List all workflows")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const { workflows: items } = await getClient().workflows.list();

				if (options.json) {
					console.log(JSON.stringify(items, null, 2));
					return;
				}

				if (items.length === 0) {
					console.log("No workflows deployed");
					return;
				}

				const rows = items.map((w) => {
					const statusColor = w.status === "active" ? green : yellow;
					return [w.name, statusColor(w.status), w.triggerType, w.createdAt];
				});

				console.log(
					formatTable(["Name", "Status", "Trigger", "Created"], rows),
				);
				console.log(dim(`\n${items.length} workflow(s) total`));
			} catch (err) {
				error(`Failed to list workflows: ${err}`);
				process.exit(1);
			}
		});

	// --- get ---
	workflows
		.command("get <name>")
		.description("Get workflow details")
		.option("--json", "Output as JSON")
		.action(async (name: string, options: { json?: boolean }) => {
			try {
				const detail = await getClient().workflows.get(name);

				if (options.json) {
					console.log(JSON.stringify(detail, null, 2));
					return;
				}

				console.log(
					formatKeyValue([
						["Name", detail.name],
						["Status", detail.status],
						["Trigger", detail.triggerType],
						["Total Runs", String(detail.totalRuns)],
						["Last Run", detail.lastRunAt ?? "never"],
						["Timeout", detail.timeout ? `${detail.timeout}ms` : "default"],
						["Created", detail.createdAt],
						["Updated", detail.updatedAt],
					]),
				);
			} catch (err) {
				error(`Failed to get workflow: ${err}`);
				process.exit(1);
			}
		});

	// --- trigger ---
	workflows
		.command("trigger <name>")
		.description("Trigger a workflow run")
		.option("--input <json>", "Input JSON string")
		.action(async (name: string, options: { input?: string }) => {
			try {
				const input = options.input ? JSON.parse(options.input) : undefined;

				const result = await getClient().workflows.trigger(name, input);
				success(`Triggered workflow "${name}"`);
				info(`Run ID: ${result.runId}`);
			} catch (err) {
				error(`Failed to trigger workflow: ${err}`);
				process.exit(1);
			}
		});

	// --- runs ---
	workflows
		.command("runs <name>")
		.description("List runs for a workflow")
		.option("--status <status>", "Filter by status")
		.option("--limit <n>", "Max runs to return", "20")
		.option("--json", "Output as JSON")
		.action(
			async (
				name: string,
				options: { status?: string; limit?: string; json?: boolean },
			) => {
				try {
					const { runs } = await getClient().workflows.listRuns(name, {
						status: options.status as
							| "running"
							| "completed"
							| "failed"
							| "cancelled"
							| undefined,
						limit: options.limit
							? Number.parseInt(options.limit, 10)
							: undefined,
					});

					if (options.json) {
						console.log(JSON.stringify(runs, null, 2));
						return;
					}

					if (runs.length === 0) {
						console.log("No runs found");
						return;
					}

					const rows = runs.map((r) => {
						const statusColor =
							r.status === "completed"
								? green
								: r.status === "failed"
									? (s: string) => `\x1b[31m${s}\x1b[0m`
									: yellow;
						return [
							r.id.slice(0, 8),
							statusColor(r.status),
							`${r.duration}ms`,
							String(r.aiTokensUsed),
							r.triggeredAt,
						];
					});

					console.log(
						formatTable(
							["ID", "Status", "Duration", "AI Tokens", "Triggered"],
							rows,
						),
					);
					console.log(dim(`\n${runs.length} run(s)`));
				} catch (err) {
					error(`Failed to list runs: ${err}`);
					process.exit(1);
				}
			},
		);

	// --- pause ---
	workflows
		.command("pause <name>")
		.description("Pause a workflow")
		.action(async (name: string) => {
			try {
				await getClient().workflows.pause(name);
				success(`Paused workflow "${name}"`);
			} catch (err) {
				error(`Failed to pause workflow: ${err}`);
				process.exit(1);
			}
		});

	// --- resume ---
	workflows
		.command("resume <name>")
		.description("Resume a paused workflow")
		.action(async (name: string) => {
			try {
				await getClient().workflows.resume(name);
				success(`Resumed workflow "${name}"`);
			} catch (err) {
				error(`Failed to resume workflow: ${err}`);
				process.exit(1);
			}
		});

	// --- delete ---
	workflows
		.command("delete <name>")
		.description("Delete a workflow")
		.option("-y, --yes", "Skip confirmation")
		.action(async (name: string, options: { yes?: boolean }) => {
			try {
				if (!options.yes) {
					const { confirm } = await import("@inquirer/prompts");
					const ok = await confirm({
						message: `Delete workflow "${name}"? This cannot be undone.`,
					});
					if (!ok) {
						info("Cancelled");
						return;
					}
				}

				await getClient().workflows.delete(name);
				success(`Deleted workflow "${name}"`);
			} catch (err) {
				error(`Failed to delete workflow: ${err}`);
				process.exit(1);
			}
		});
}
