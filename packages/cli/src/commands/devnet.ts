import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import {
	DEFAULT_IMAGE_TAG,
	buildDevnetCompose,
} from "../lib/devnet-compose.ts";
import {
	DEFAULT_INDEXER_OBSERVER,
	ensureEventObserver,
	findClarinetProject,
} from "../lib/devnet-config.ts";
import { bold, cyan, dim, error, green, red, yellow } from "../lib/output.ts";

const COMPOSE_REL = join(".secondlayer", "docker-compose.yml");

// child_process (not Bun.$) so the command works under both node and bun —
// the published CLI runs under node via its shebang.
function ensureDocker(): void {
	const probe = spawnSync("docker", ["info"], { stdio: "ignore" });
	if (probe.error || probe.status !== 0) {
		error(
			"Docker isn't available.\n\n" +
				"Start Docker Desktop or OrbStack (macOS), or install Docker:\n" +
				"  macOS:  brew install --cask docker  (or https://orbstack.dev)\n" +
				"  Linux:  curl -fsSL https://get.docker.com | sh",
		);
		process.exit(1);
	}
}

function dockerCompose(composePath: string, args: string[]): number {
	const res = spawnSync("docker", ["compose", "-f", composePath, ...args], {
		stdio: "inherit",
	});
	return res.status ?? 1;
}

interface ConnectOptions {
	project?: string;
	imageTag: string;
	owner?: string;
	up: boolean;
}

interface DownOptions {
	project?: string;
	purge?: boolean;
}

interface LogsOptions {
	project?: string;
	follow?: boolean;
	lines?: string;
	/** Deprecated alias for `lines`. */
	tail?: string;
}

interface StatusOptions {
	watch?: boolean;
	limit: string;
}

const API_URL = process.env.SL_API_URL ?? "http://localhost:3800";
const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:3700";

const SERVICES = [
	"indexer",
	"api",
	"subgraph-processor",
	"postgres",
	"migrate",
];

export function registerDevnetCommand(program: Command): void {
	const devnet = program
		.command("devnet")
		.description("Run Secondlayer services against a local Clarinet devnet");

	devnet
		.command("connect")
		.description(
			"Point your clarinet project's devnet at a local Secondlayer stack and start it",
		)
		.option(
			"--project <dir>",
			"Clarinet project directory (defaults to the nearest Clarinet.toml)",
		)
		.option(
			"--image-tag <tag>",
			"Published image tag to run",
			DEFAULT_IMAGE_TAG,
		)
		.option("--owner <owner>", "ghcr image owner (namespace) to pull from")
		.option("--no-up", "Patch config + write compose without starting docker")
		.action(async (options: ConnectOptions) => {
			await connect(options);
		});

	devnet
		.command("down")
		.description(
			"Stop the local Secondlayer stack started by `sl devnet connect`",
		)
		.option("--project <dir>", "Clarinet project directory")
		.option("--purge", "Also remove volumes (wipes the local index)")
		.action(async (options: DownOptions) => {
			await down(options);
		});

	devnet
		.command("status")
		.description(
			"Snapshot of the local stack: ingest, subgraphs, and recent activity",
		)
		.option("-w, --watch", "Refresh every 2s until Ctrl-C")
		.option("--limit <n>", "Recent activity rows to show", "12")
		.action(async (options: StatusOptions) => {
			await status(options);
		});

	devnet
		.command("logs [service]")
		.description(
			"Tail stack logs — all services, or one of: indexer, api, subgraph-processor, postgres",
		)
		.option("--project <dir>", "Clarinet project directory")
		.option("-f, --follow", "Follow log output")
		.option("-n, --lines <n>", "Lines to show from the end of each log")
		.option("--tail <n>", "Deprecated alias for --lines")
		.action(async (service: string | undefined, options: LogsOptions) => {
			await logs(service, options);
		});
}

function resolveProject(explicit?: string): string {
	if (explicit) {
		if (!existsSync(join(explicit, "Clarinet.toml"))) {
			error(`No Clarinet.toml in ${explicit}`);
			process.exit(1);
		}
		return explicit;
	}
	const found = findClarinetProject(process.cwd());
	if (!found) {
		error(
			"No Clarinet.toml found in this directory or any parent.\n" +
				"Run this from inside a clarinet project, or pass --project <dir>.",
		);
		process.exit(1);
	}
	return found;
}

async function connect(options: ConnectOptions): Promise<void> {
	const project = resolveProject(options.project);

	// 1. Patch settings/Devnet.toml so the devnet node forwards events to us.
	const devnetToml = join(project, "settings", "Devnet.toml");
	mkdirSync(dirname(devnetToml), { recursive: true });
	const result = ensureEventObserver(devnetToml, DEFAULT_INDEXER_OBSERVER);

	console.log(`${green("✓")} found Clarinet.toml`);
	if (result.status === "present") {
		console.log(
			dim(
				`  settings/Devnet.toml already forwards to ${DEFAULT_INDEXER_OBSERVER}`,
			),
		);
	} else {
		console.log(
			`${green("✓")} ${result.status === "created" ? "created" : "patched"} settings/Devnet.toml`,
		);
		console.log(
			dim(
				`    + stacks_node_events_observers = ["${DEFAULT_INDEXER_OBSERVER}"]`,
			),
		);
	}

	// 2. Write the embedded compose for the published OSS images.
	const composePath = join(project, COMPOSE_REL);
	mkdirSync(dirname(composePath), { recursive: true });
	writeFileSync(
		composePath,
		buildDevnetCompose({ owner: options.owner, imageTag: options.imageTag }),
	);
	console.log(`${green("✓")} wrote ${COMPOSE_REL}`);

	// 3. Bring the stack up (unless --no-up).
	if (!options.up) {
		console.log(
			dim(
				`\nSkipped docker. Start it with:\n  docker compose -f ${COMPOSE_REL} up -d`,
			),
		);
		return;
	}

	ensureDocker();

	console.log(dim("\nStarting Secondlayer stack (docker compose up -d)…"));
	if (dockerCompose(composePath, ["up", "-d"]) !== 0) {
		error("docker compose up failed — see output above.");
		process.exit(1);
	}

	console.log(`\n${bold("Secondlayer stack up")}`);
	console.log(`  api      → ${cyan("http://localhost:3800")}`);
	console.log(`  indexer  → ${cyan("http://localhost:3700")}`);
	console.log(`\n${bold("Next:")}`);
	console.log(
		`  ${yellow("clarinet devnet start")}   ${dim("# auto-deploys + streams to the indexer")}`,
	);
	console.log(
		`  ${yellow("SL_API_URL=http://localhost:3800 SL_SERVICE_KEY=dummy sl subgraphs deploy ./subgraph.ts")}`,
	);
	console.log(dim("\nStop with: sl devnet down"));
}

async function down(options: DownOptions): Promise<void> {
	const project = resolveProject(options.project);
	const composePath = join(project, COMPOSE_REL);
	if (!existsSync(composePath)) {
		error(
			`No ${COMPOSE_REL} in ${project} — nothing to stop. Run \`sl devnet connect\` first.`,
		);
		process.exit(1);
	}

	ensureDocker();

	const args = options.purge ? ["down", "-v"] : ["down"];
	if (dockerCompose(composePath, args) !== 0) {
		error("docker compose down failed — see output above.");
		process.exit(1);
	}
	console.log(
		`${green("✓")}${options.purge ? " stack stopped, volumes removed" : " stack stopped"}`,
	);
}

async function logs(
	service: string | undefined,
	options: LogsOptions,
): Promise<void> {
	const project = resolveProject(options.project);
	const composePath = join(project, COMPOSE_REL);
	if (!existsSync(composePath)) {
		error(`No ${COMPOSE_REL} in ${project} — run \`sl devnet connect\` first.`);
		process.exit(1);
	}
	if (service && !SERVICES.includes(service)) {
		error(
			`Unknown service "${service}". Choose one of: ${SERVICES.join(", ")}`,
		);
		process.exit(1);
	}

	ensureDocker();

	const args = ["logs", "--tail", options.lines ?? options.tail ?? "200"];
	if (options.follow) args.push("-f");
	if (service) args.push(service);
	// stdio is inherited, so `-f` streams until the user Ctrl-C's.
	process.exit(dockerCompose(composePath, args));
}

// biome-ignore lint/suspicious/noExplicitAny: parses untyped local API JSON
async function jget(url: string): Promise<any | null> {
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
		return r.ok ? await r.json() : null;
	} catch {
		return null;
	}
}

// System columns the subgraph runtime adds — hidden from the activity summary.
const SYS_COLS = new Set([
	"_id",
	"_block_height",
	"_tx_id",
	"_created_at",
	"block_height",
	"tx_id",
]);

// Truncate principals / hashes to head…tail; leave short values (amounts) alone.
function shortVal(v: unknown): string {
	const s = String(v);
	return s.length > 18 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

async function renderStatus(limit: number): Promise<string> {
	const [health, integrity, subsRes, apiHealth] = await Promise.all([
		jget(`${INDEXER_URL}/health`),
		jget(`${INDEXER_URL}/health/integrity`),
		jget(`${API_URL}/api/subgraphs`),
		jget(`${API_URL}/health`),
	]);
	const out: string[] = [];

	// STACK
	out.push(bold("STACK"));
	out.push(
		`  ${health ? green("●") : red("●")} indexer   ${health ? "healthy" : "down"}   ${dim(":3700")}`,
	);
	out.push(
		`  ${apiHealth ? green("●") : red("●")} api       ${apiHealth ? "healthy" : "down"}   ${dim(":3800")}`,
	);
	if (!health) {
		out.push("");
		out.push(dim("  indexer unreachable — is `sl devnet connect` running?"));
		return out.join("\n");
	}

	// INGEST
	const tip = Number(health.lastSeenHeight ?? integrity?.lastIndexedBlock ?? 0);
	const indexed = Number(integrity?.lastIndexedBlock ?? tip);
	const lag = Math.max(0, tip - indexed);
	const ago = health.lastBlockReceivedSecondsAgo;
	out.push("");
	out.push(bold("INGEST"));
	out.push(
		`  chain tip ${cyan(String(tip))}   indexed ${indexed}   lag ${lag === 0 ? green("caught up") : yellow(`${lag} blk`)}   ${dim(`last block ${ago != null ? `${ago}s ago` : "?"}`)}`,
	);

	// SUBGRAPHS
	// biome-ignore lint/suspicious/noExplicitAny: untyped API rows
	const subs: any[] = subsRes?.data ?? [];
	out.push("");
	out.push(bold("SUBGRAPHS"));
	if (subs.length === 0) {
		out.push(dim("  none deployed — sl subgraphs deploy ./subgraph.ts"));
	} else {
		for (const sg of subs) {
			const st =
				sg.status === "active" ? green(sg.status) : yellow(String(sg.status));
			const tables = (sg.tables ?? []).join(", ");
			out.push(
				`  ${sg.name}   ${st}   ${dim(`block ${sg.lastProcessedBlock}`)}   ${tables} ${dim(`· ${sg.totalRows ?? 0} rows`)}`,
			);
		}
	}

	// ACTIVITY — recent rows across every deployed subgraph table.
	out.push("");
	out.push(bold("ACTIVITY") + dim("  (recent)"));
	const rows: { block: number; table: string; summary: string }[] = [];
	for (const sg of subs) {
		for (const table of sg.tables ?? []) {
			const res = await jget(
				`${API_URL}/api/subgraphs/${sg.name}/${table}?_limit=${limit}&_sort=_block_height&_order=desc`,
			);
			for (const row of res?.data ?? []) {
				const summary = Object.entries(row)
					.filter(([k]) => !SYS_COLS.has(k))
					.map(([, v]) => shortVal(v))
					.join("  ");
				rows.push({ block: Number(row._block_height ?? 0), table, summary });
			}
		}
	}
	rows.sort((a, b) => b.block - a.block);
	if (rows.length === 0) {
		out.push(dim("  no indexed rows yet — fire a contract call"));
	} else {
		for (const r of rows.slice(0, limit)) {
			out.push(
				`  ${dim(String(r.block).padStart(5))}  ${r.table.padEnd(16)} ${r.summary}`,
			);
		}
	}

	return out.join("\n");
}

async function status(options: StatusOptions): Promise<void> {
	const limit = Math.max(1, Number(options.limit) || 12);
	if (!options.watch) {
		console.log(await renderStatus(limit));
		return;
	}
	const tick = async () => {
		const body = await renderStatus(limit);
		process.stdout.write("\x1b[2J\x1b[H"); // clear + home
		console.log(`${dim("sl devnet status")}  ${dim("· ctrl-c to stop")}\n`);
		console.log(body);
	};
	await tick();
	const id = setInterval(() => void tick(), 2000);
	process.on("SIGINT", () => {
		clearInterval(id);
		process.stdout.write("\n");
		process.exit(0);
	});
}
