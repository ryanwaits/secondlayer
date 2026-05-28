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
import { bold, cyan, dim, error, green, yellow } from "../lib/output.ts";

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
