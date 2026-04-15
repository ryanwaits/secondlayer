import type { Command } from "commander";
import { requireLocalNetwork } from "../lib/config.ts";

// Dev service imports
import { loadDevState } from "../lib/dev-state.ts";

// Node service imports
import {
	getNodeContainers,
	getNodeLogs,
	isNodeRunning,
} from "../lib/node-manager.ts";

// Output helpers
import {
	blue,
	cyan,
	dim,
	error,
	green,
	magenta,
	red,
	yellow,
} from "../lib/output.ts";

// Service definitions
const DEV_SERVICES = ["api", "indexer", "worker", "subgraphs"] as const;
type DevService = (typeof DEV_SERVICES)[number];

export function registerLocalCommand(program: Command): void {
	const local = program
		.command("local")
		.description("Manage local development environment and Stacks node")
		.hook("preAction", async (_thisCommand, actionCommand) => {
			// Skip preAction for help commands
			if (actionCommand.name() === "help") return;
			await requireLocalNetwork();
		});

	// Start subcommand
	local
		.command("start")
		.description("Start all local dev services (API, indexer, worker)")
		.option("--indexer-port <port>", "Indexer port", "3700")
		.option("--api-port <port>", "API port", "3800")
		.option("--no-worker", "Skip worker service")
		.option(
			"--stacks-node",
			"Use port 3701 for indexer (avoids conflict with stacks-blockchain-api)",
		)
		.option("-f, --foreground", "Run in foreground (blocking)")
		.action(async (options) => {
			// Import dynamically to avoid circular deps
			const { runBackground, runForeground, isDevAlreadyRunning } =
				await import("./dev-impl.ts");

			if (await isDevAlreadyRunning()) {
				return;
			}

			if (options.foreground) {
				await runForeground(options);
			} else {
				await runBackground(options);
			}
		});

	// Stop subcommand
	local
		.command("stop")
		.description("Stop all local dev services")
		.action(async () => {
			const { stopDev } = await import("./dev-impl.ts");
			await stopDev();
		});

	// Restart subcommand
	local
		.command("restart")
		.description("Restart dev services (preserves docker containers)")
		.action(async () => {
			const { restartDev } = await import("./dev-impl.ts");
			await restartDev();
		});

	// Status subcommand
	local
		.command("status")
		.description("Show local environment status")
		.action(async () => {
			await showLocalStatus();
		});

	// Logs subcommand
	local
		.command("logs")
		.description("View local service logs (dev + node)")
		.option(
			"-s, --service <name>",
			"Filter by service (api, indexer, worker, subgraphs, node)",
		)
		.option("-f, --follow", "Follow log output")
		.option("-n, --lines <n>", "Number of lines to show", "50")
		.option("-q, --quiet", "Filter out common noise")
		.action(
			async (options: {
				service?: string;
				follow?: boolean;
				lines: string;
				quiet?: boolean;
				verbose?: boolean;
			}) => {
				await showLocalLogs(options);
			},
		);

	// Node subcommand group
	const node = local.command("node").description("Manage local Stacks node");

	// Node setup
	node
		.command("setup")
		.description("Interactive setup wizard for Stacks node")
		.action(async () => {
			const { runSetupWizard } = await import("./node-impl.ts");
			await runSetupWizard();
		});

	// Node start
	node
		.command("start")
		.description("Start the Stacks node")
		.option(
			"-p, --path <path>",
			"Path to stacks-blockchain-docker (overrides config)",
		)
		.option("--with-indexer", "Also start indexer")
		.action(async (options: { path?: string; withIndexer?: boolean }) => {
			const { startNode } = await import("./node-impl.ts");
			await startNode(options.path, options.withIndexer);
		});

	// Node stop
	node
		.command("stop")
		.description("Stop the Stacks node")
		.option(
			"-p, --path <path>",
			"Path to stacks-blockchain-docker (overrides config)",
		)
		.option("-f, --force", "Skip confirmation")
		.option("--wait", "Wait for in-flight work to drain first")
		.action(
			async (options: { path?: string; force?: boolean; wait?: boolean }) => {
				const { stopNode } = await import("./node-impl.ts");
				await stopNode(options.path, options.force, options.wait);
			},
		);

	// Node restart
	node
		.command("restart")
		.description("Restart the Stacks node (stop then start)")
		.option(
			"-p, --path <path>",
			"Path to stacks-blockchain-docker (overrides config)",
		)
		.option("-f, --force", "Skip confirmation")
		.option(
			"--wait",
			"Wait for in-flight work to drain before stopping",
		)
		.action(
			async (options: { path?: string; force?: boolean; wait?: boolean }) => {
				const { restartNode } = await import("./node-impl.ts");
				await restartNode(options.path, options.force, options.wait);
			},
		);

	// Node status
	node
		.command("status")
		.description("Show Stacks node status")
		.option(
			"-p, --path <path>",
			"Path to stacks-blockchain-docker (overrides config)",
		)
		.option("--json", "Output as JSON")
		.action(async (options: { path?: string; json?: boolean }) => {
			const { showStatus } = await import("./node-impl.ts");
			await showStatus(options.path, options.json);
		});

	// Node config
	node
		.command("config")
		.description("Show node configuration")
		.option("--edit", "Edit configuration interactively")
		.action(async (options: { edit?: boolean }) => {
			const { showConfig, runSetupWizard } = await import("./node-impl.ts");
			if (options.edit) {
				await runSetupWizard();
			} else {
				await showConfig();
			}
		});

	// Node config-check
	node
		.command("config-check")
		.description("Show events observer configuration for Config.toml")
		.option("--indexer-port <port>", "Indexer port to display", "3700")
		.action(async (options: { indexerPort: string }) => {
			const { showConfigCheck } = await import("./node-impl.ts");
			await showConfigCheck(Number.parseInt(options.indexerPort));
		});

	// Node logs (shortcut)
	node
		.command("logs")
		.description("View Stacks node logs")
		.option("-f, --follow", "Follow log output")
		.option("-n, --lines <n>", "Number of lines to show", "50")
		.option("-q, --quiet", "Filter out common noise")
		.action(
			async (options: { follow?: boolean; lines: string; quiet?: boolean }) => {
				await showLocalLogs({ ...options, service: "node" });
			},
		);
}

// ==================== Status Implementation ====================

async function showLocalStatus(): Promise<void> {
	const { showDevStatus } = await import("./dev-impl.ts");

	// Show dev status
	await showDevStatus();

	// Also show node summary if running
	const nodeRunning = await isNodeRunning();
	if (nodeRunning) {
		console.log("");
		await showNodeSummary();
	}
}

async function showNodeSummary(): Promise<void> {
	console.log(blue("Stacks Node"));

	try {
		const infoRes = await fetch("http://localhost:20443/v2/info", {
			signal: AbortSignal.timeout(2000),
		});

		if (infoRes.ok) {
			const nodeInfo = (await infoRes.json()) as {
				stacks_tip_height?: number;
				burn_block_height?: number;
			};
			console.log(`  ${green("+")} Running`);
			console.log(
				`  ${dim("Stacks height:")} ${nodeInfo.stacks_tip_height ?? "syncing..."}`,
			);
			console.log(
				`  ${dim("Burn height:")} ${nodeInfo.burn_block_height ?? "syncing..."}`,
			);
		} else {
			console.log(`  ${yellow("~")} Starting up (RPC not responding)`);
		}
	} catch {
		const containers = await getNodeContainers();
		if (containers.length > 0) {
			console.log(`  ${yellow("~")} Starting up (RPC not responding)`);
		} else {
			console.log(`  ${dim("-")} Not running`);
		}
	}
}

// ==================== Logs Implementation ====================

const serviceColors: Record<string, (text: string) => string> = {
	api: blue,
	indexer: cyan,
	worker: yellow,
	subgraphs: magenta,
	node: red,
};

async function showLocalLogs(options: {
	service?: string;
	follow?: boolean;
	lines: string;
	quiet?: boolean;
}): Promise<void> {
	const lines = Number.parseInt(options.lines);
	const service = options.service?.toLowerCase();

	const showDev =
		!service ||
		service === "dev" ||
		DEV_SERVICES.includes(service as DevService);
	const showNode = !service || service === "node";

	if (service && DEV_SERVICES.includes(service as DevService)) {
		const { showLogs } = await import("./dev-impl.ts");
		await showLogs({
			follow: options.follow,
			service,
			lines: options.lines,
		});
		return;
	}

	if (service === "node") {
		await showNodeLogs(options);
		return;
	}

	if (options.follow) {
		await followCombinedLogs(showDev, showNode, lines, options.quiet ?? false);
	} else {
		await showStaticCombinedLogs(
			showDev,
			showNode,
			lines,
			options.quiet ?? false,
		);
	}
}

async function showNodeLogs(options: {
	follow?: boolean;
	lines: string;
	quiet?: boolean;
}): Promise<void> {
	if (!(await isNodeRunning())) {
		error("Node is not running");
		console.log(dim("Run 'sl local node start' first"));
		process.exit(1);
	}

	const logs = await getNodeLogs({
		follow: options.follow,
		lines: Number.parseInt(options.lines),
		quiet: options.quiet,
		format: true,
	});

	for await (const line of logs) {
		console.log(line);
	}
}

interface LogEntry {
	service: string;
	line: string;
	timestamp: Date;
}

async function showStaticCombinedLogs(
	showDev: boolean,
	showNode: boolean,
	lines: number,
	quiet: boolean,
): Promise<void> {
	const allLines: LogEntry[] = [];

	// Collect dev logs
	if (showDev) {
		const state = await loadDevState();
		if (state && Object.keys(state.services).length > 0) {
			for (const [name, service] of Object.entries(state.services)) {
				try {
					const content = await Bun.file(service.logFile).text();
					const fileLines = content.trim().split("\n").slice(-lines);

					for (const line of fileLines) {
						if (!line.trim()) continue;
						const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
						const timestamp = tsMatch ? new Date(tsMatch[1]!) : new Date(0);
						allLines.push({ service: name, line, timestamp });
					}
				} catch {
					// File doesn't exist
				}
			}
		}
	}

	// Collect node logs
	if (showNode && (await isNodeRunning())) {
		const logs = await getNodeLogs({ lines, quiet, format: true });
		for await (const line of logs) {
			// Parse timestamp from formatted line: [service] [timestamp] LEVEL: message
			const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
			const timestamp = tsMatch ? new Date(tsMatch[1]!) : new Date(0);
			allLines.push({ service: "node", line, timestamp });
		}
	}

	// Sort by timestamp
	allLines.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	// Print last N lines
	for (const { service, line } of allLines.slice(-lines)) {
		console.log(formatLogLine(service, line));
	}
}

async function followCombinedLogs(
	showDev: boolean,
	showNode: boolean,
	initialLines: number,
	quiet: boolean,
): Promise<void> {
	await showStaticCombinedLogs(showDev, showNode, initialLines, quiet);

	const procs: ReturnType<typeof Bun.spawn>[] = [];

	// Follow dev logs
	if (showDev) {
		const state = await loadDevState();
		if (state) {
			for (const [name, service] of Object.entries(state.services)) {
				const proc = Bun.spawn(["tail", "-f", "-n", "0", service.logFile], {
					stdout: "pipe",
					stderr: "pipe",
				});
				procs.push(proc);
				pipeProcLogs(proc, name);
			}
		}
	}

	// Follow node logs
	if (showNode && (await isNodeRunning())) {
		const proc = Bun.spawn(
			["docker", "logs", "-f", "--tail", "0", "stacks-blockchain"],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		procs.push(proc);
		pipeProcLogs(proc, "node");
	}

	// Handle Ctrl+C
	process.on("SIGINT", () => {
		for (const proc of procs) {
			try {
				proc.kill();
			} catch {}
		}
		process.exit(0);
	});

	// Keep running
	await new Promise(() => {});
}

function pipeProcLogs(
	proc: ReturnType<typeof Bun.spawn>,
	serviceName: string,
): void {
	const readStream = async (stream: ReadableStream<Uint8Array> | null) => {
		if (!stream) return;
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (line.trim()) {
					console.log(formatLogLine(serviceName, line));
				}
			}
		}
	};

	readStream(proc.stdout as ReadableStream<Uint8Array>);
	readStream(proc.stderr as ReadableStream<Uint8Array>);
}

function formatLogLine(service: string, line: string): string {
	const colorFn = serviceColors[service] ?? dim;
	const prefix = colorFn(`[${service}]`);

	if (service === "node" && line.startsWith("[")) {
		return `${prefix} ${line}`;
	}

	const match = line.match(
		/^(\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\])\s*(INFO|WARN|ERROR|DEBUG):?\s*(.*)$/,
	);

	if (match) {
		const [, timestamp, level, message] = match;
		const dimTimestamp = dim(timestamp!);

		if (level === "ERROR") {
			return `${prefix} ${dimTimestamp} ${red(level + ":")} ${message}`;
		} else if (level === "WARN") {
			return `${prefix} ${dimTimestamp} ${yellow(level + ":")} ${message}`;
		} else if (level === "INFO") {
			return `${prefix} ${dimTimestamp} ${green(level + ":")} ${message}`;
		} else if (level === "DEBUG") {
			return `${prefix} ${dimTimestamp} ${dim(level + ":")} ${dim(message!)}`;
		}
	}

	return `${prefix} ${line}`;
}
