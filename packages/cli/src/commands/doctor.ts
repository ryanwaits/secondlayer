import type { Command } from "commander";
import { authHeaders } from "../lib/api-client.ts";
import { getDataDir, loadConfig, resolveApiUrl } from "../lib/config.ts";
import { checkHealth } from "../lib/health.ts";
import { type Network, getChainIdHex } from "../lib/network.ts";
import {
	blue,
	dim,
	formatKeyValue,
	green,
	red,
	success,
	warn,
	yellow,
} from "../lib/output.ts";

export function registerDoctorCommand(program: Command): void {
	program
		.command("doctor")
		.description("Run diagnostics on the full stack")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			const config = await loadConfig();
			if (config.network === "local") {
				await runLocalDoctor(options.json);
			} else {
				await runHostedDoctor(options.json);
			}
		});
}

async function runHostedDoctor(jsonOutput?: boolean): Promise<void> {
	const config = await loadConfig();
	const apiUrl = resolveApiUrl(config);
	const issues: string[] = [];

	const results: Record<string, unknown> = { network: config.network, apiUrl };

	// API health
	let apiHealthy = false;
	let statusData: Record<string, unknown> | null = null;
	try {
		const res = await fetch(`${apiUrl}/status`, {
			headers: authHeaders(config),
		});
		apiHealthy = res.ok;
		if (res.ok) {
			statusData = (await res.json()) as Record<string, unknown>;
		} else if (res.status === 401) {
			issues.push("Authentication failed. Run: sl auth login");
		} else {
			issues.push(`API returned HTTP ${res.status}`);
		}
	} catch {
		issues.push(`Cannot reach API at ${apiUrl}`);
	}
	results.apiHealthy = apiHealthy;

	// Auth status
	let authOk = false;
	let account: { email?: string; plan?: string } | null = null;
	try {
		const res = await fetch(`${apiUrl}/api/accounts/me`, {
			headers: authHeaders(config),
		});
		if (res.ok) {
			authOk = true;
			account = (await res.json()) as { email: string; plan: string };
		} else if (res.status === 401) {
			issues.push("Not authenticated. Run: sl auth login");
		}
	} catch {}
	results.authOk = authOk;
	results.account = account;

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

	// Auth
	console.log(blue("Auth"));
	if (authOk && account) {
		console.log(`  ${green("✓")} Authenticated`);
		console.log(
			formatKeyValue([
				["  Email", account.email ?? dim("unknown")],
				["  Plan", account.plan ?? dim("unknown")],
			]),
		);
	} else {
		console.log(`  ${red("✗")} Not authenticated`);
	}
	console.log("");

	// Index progress from /status
	if (statusData) {
		const progress = statusData.indexProgress as
			| Array<{
					network: string;
					lastIndexedBlock: number;
					highestSeenBlock: number;
			  }>
			| undefined;
		if (progress?.length) {
			console.log(blue("Index Progress"));
			for (const p of progress) {
				const behind = p.highestSeenBlock - p.lastIndexedBlock;
				const behindStr =
					behind > 0 ? yellow(` (${behind} behind)`) : green(" (synced)");
				console.log(`  ${p.network}: block ${p.lastIndexedBlock}${behindStr}`);
			}
			console.log("");
		}

	}

	// Issues
	console.log(blue("Issues"));
	if (issues.length === 0) {
		console.log(`  ${green("None")}`);
	} else {
		for (const issue of issues) {
			console.log(`  ${red("•")} ${issue}`);
		}
	}
	console.log("");

	if (issues.length > 0) {
		warn(`${issues.length} issue(s) found`);
	} else {
		success("All checks passed");
	}
	console.log("");
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
				const parts = lines[1]!.split(/\s+/);
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
