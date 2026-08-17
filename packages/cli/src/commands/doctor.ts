import type { Command } from "commander";
import { getDataDir, loadConfig } from "../lib/config.ts";
import { checkHealth } from "../lib/health.ts";
import { httpPlatformAnon } from "../lib/http.ts";
import {
	type InstanceDiagnosis,
	type InstanceIssue,
	type PublicStatus,
	diagnoseInstanceStatus,
} from "../lib/instance-diagnosis.ts";
import { type Network, getChainIdHex } from "../lib/network.ts";
import {
	blue,
	dim,
	formatKeyValue,
	green,
	red,
	success,
	warn,
	wrapText,
	yellow,
} from "../lib/output.ts";
import { resolveApiUrl } from "../lib/resolve-auth.ts";

export function registerDoctorCommand(program: Command): void {
	program
		.command("doctor")
		.description("Run diagnostics on the full stack")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			const config = await loadConfig();
			if (config.network === "local") {
				await runLocalDoctor(options.json);
				return;
			}
			await runInstanceDoctor(options.json);
		});
}

async function runInstanceDoctor(jsonOutput?: boolean): Promise<void> {
	const config = await loadConfig();
	const apiUrl = resolveApiUrl();

	const results: Record<string, unknown> = { network: config.network, apiUrl };

	let apiHealthy = false;
	let statusData: PublicStatus | null = null;
	let unreachableError: string | null = null;
	try {
		statusData = await httpPlatformAnon<PublicStatus>("/public/status");
		apiHealthy = true;
	} catch (err) {
		unreachableError = err instanceof Error ? err.message : String(err);
	}
	results.apiHealthy = apiHealthy;

	// `doctor` and `status` read the same payload through the same diagnosis, so
	// doctor can no longer report "All checks passed" while status reports
	// DEGRADED — that contradiction left callers guessing whether to proceed.
	const diagnosis = statusData ? diagnoseInstanceStatus(statusData) : null;
	const issues: InstanceIssue[] = diagnosis
		? diagnosis.issues
		: [
				{
					title: `Cannot reach ${apiUrl}/public/status.`,
					detail: unreachableError ?? undefined,
					nextSteps: [
						"Start the instance from docker/oss: docker compose up -d",
						`If it runs elsewhere, point the CLI at it: SL_API_URL=<url> (currently ${apiUrl})`,
					],
				},
			];

	if (jsonOutput) {
		console.log(
			JSON.stringify({ ...results, status: statusData, issues }, null, 2),
		);
		return;
	}

	console.log("");
	console.log(blue("Network"));
	console.log(`  ${config.network} ${dim(`(${apiUrl})`)}`);
	console.log("");

	// API health
	console.log(blue("API"));
	console.log(
		`  ${apiHealthy ? green("✓") : red("✗")} ${apiHealthy ? green("reachable") : red("unreachable")}`,
	);
	console.log("");

	if (statusData) {
		const tip = statusData.chainTip;
		const streams = statusData.streams;
		const index = statusData.index;
		const blocks = statusData.chainIntegrity?.maxHeight;
		console.log(blue("Instance"));
		console.log(`  status: ${statusData.status ?? "unknown"}`);
		if (typeof tip === "number") console.log(`  tip: ${tip.toLocaleString()}`);
		if (typeof blocks === "number") {
			console.log(`  blocks indexed: ${blocks.toLocaleString()}`);
		}
		if (streams?.status) console.log(`  streams: ${streams.status}`);
		if (index?.status) console.log(`  index: ${index.status}`);
		console.log("");
	}

	// Issues
	console.log(blue("Issues"));
	if (issues.length === 0) {
		console.log(`  ${green("None")}`);
	} else {
		for (const issue of issues) {
			console.log(`  ${red("•")} ${issue.title}`);
			for (const line of issue.detail ? wrapText(issue.detail, 72) : []) {
				console.log(dim(`    ${line}`));
			}
			for (const step of issue.nextSteps) {
				console.log(dim(`    → ${step}`));
			}
		}
	}
	console.log("");

	if (issues.length > 0) {
		warn(
			`${issues.length} issue${issues.length === 1 ? "" : "s"} found${doctorVerdictSuffix(diagnosis)}`,
		);
	} else {
		success("All checks passed");
	}
	console.log("");
}

/** Why the run ended with issues, in the fewest words that stay true. */
function doctorVerdictSuffix(diagnosis: InstanceDiagnosis | null): string {
	if (!diagnosis) return " — the CLI could not reach this instance.";
	if (diagnosis.state === "empty-index") {
		return " — the instance is up but holds no chain data yet.";
	}
	return ` — the API reports status=${diagnosis.overall}.`;
}

async function runLocalDoctor(jsonOutput?: boolean): Promise<void> {
	const config = await loadConfig();
	const report = await checkHealth();

	if (jsonOutput) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	const network = config.node?.network as Network | undefined;
	const chainIdHex = network ? getChainIdHex(network) : "N/A";

	console.log("");
	console.log(blue("Stack"));
	console.log(
		formatKeyValue([
			["  Network", network ?? dim("not configured")],
			[
				"  Chain ID",
				network
					? `${chainIdHex} (${report.node.chainIdValid ? green("valid") : red("MISMATCH")})`
					: dim("N/A"),
			],
		]),
	);
	console.log("");

	// Node
	console.log(blue("Node"));
	if (report.node.running) {
		const heightStr = report.node.height?.toString() ?? "syncing...";
		const burnStr = report.node.burnHeight
			? `(burn: ${report.node.burnHeight})`
			: "";
		console.log(
			formatKeyValue([
				["  Height", `${heightStr} ${burnStr}`],
				["  Peers", report.node.peers.toString()],
				[
					"  Status",
					report.node.height ? green("syncing") : yellow("starting"),
				],
				["  Version", report.node.version ?? dim("unknown")],
			]),
		);
	} else {
		console.log(`  ${red("Not running")}`);
	}
	console.log("");

	// Containers
	if (report.containers.length > 0) {
		console.log(blue("Containers"));
		for (const c of report.containers) {
			const icon =
				c.health === "healthy" || c.health === "running"
					? green("✓")
					: c.health === "exited"
						? red("✗")
						: yellow("~");
			const restartInfo =
				c.restartCount > 0 ? yellow(` (${c.restartCount} restarts)`) : "";
			console.log(`  ${icon} ${c.name.padEnd(30)} ${c.status}${restartInfo}`);
		}
		console.log("");
	}

	// Services
	if (report.services.length > 0) {
		console.log(blue("Services"));
		for (const s of report.services) {
			const icon =
				s.running && s.responsive
					? green("✓")
					: s.running
						? yellow("~")
						: red("✗");
			const portStr = s.port ? `:${s.port}` : "";
			const statusStr =
				s.running && s.responsive
					? green("healthy")
					: s.running
						? yellow("unresponsive")
						: red("crashed");
			console.log(
				`  ${icon} ${s.name.padEnd(12)} ${portStr.padEnd(6)} pid ${s.pid}  ${statusStr}`,
			);
		}
		console.log("");
	}

	// Infrastructure
	console.log(blue("Infrastructure"));
	console.log(
		`  ${report.infrastructure.postgres ? green("✓") : red("✗")} PostgreSQL`,
	);
	console.log("");

	// Config check
	console.log(blue("Config"));
	const configPath = (await import("../lib/config.ts")).getConfigPath();
	const dataDir = getDataDir(config);
	console.log(
		formatKeyValue([
			["  Config", dim(configPath)],
			["  Data dir", dim(dataDir)],
			["  Node path", dim(config.node?.installPath ?? "not set")],
		]),
	);
	console.log("");

	// Disk space for data dir
	try {
		const result = await Bun.$`df -h ${dataDir}`.quiet().nothrow();
		if (result.exitCode === 0) {
			const lines = result.stdout.toString().trim().split("\n");
			if (lines.length >= 2) {
				const parts = lines[1]?.split(/\s+/);
				const used = parts[2];
				const avail = parts[3];
				const pct = parts[4];
				console.log(blue("Disk"));
				console.log(`  Used: ${used}  Available: ${avail}  (${pct})`);
				console.log("");
			}
		}
	} catch {}

	// Log file sizes
	try {
		const { getLogsDir } = await import("../lib/dev-state.ts");
		const logsDir = getLogsDir();
		const result = await Bun.$`du -sh ${logsDir}`.quiet().nothrow();
		if (result.exitCode === 0) {
			const size = result.stdout.toString().trim().split("\t")[0];
			console.log(blue("Logs"));
			console.log(`  Total size: ${size}  ${dim(logsDir)}`);
			console.log("");
		}
	} catch {}

	// Issues
	console.log(blue("Issues"));
	if (report.issues.length === 0) {
		console.log(`  ${green("None")}`);
	} else {
		for (const issue of report.issues) {
			console.log(`  ${red("•")} ${issue}`);
		}
	}
	console.log("");

	if (report.issues.length > 0) {
		warn(`${report.issues.length} issue(s) found`);
	} else {
		success("All checks passed");
	}
	console.log("");
}
