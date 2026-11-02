import { isProcessRunning, loadDevState } from "./dev-state.ts";
import { type Network, networkFromId } from "./network.ts";

export interface NodeHealth {
	running: boolean;
	network: Network | null;
	height: number | null;
	burnHeight: number | null;
	chainId: number | null;
	peers: number;
	version: string | null;
}

export interface ContainerHealth {
	name: string;
	status: string;
	health: string;
	restartCount: number;
}

export interface ServiceHealth {
	name: string;
	pid: number;
	port: number | null;
	running: boolean;
	responsive: boolean;
}

export interface InfraHealth {
	postgres: boolean;
}

export interface HealthReport {
	node: NodeHealth;
	containers: ContainerHealth[];
	services: ServiceHealth[];
	infrastructure: InfraHealth;
	issues: string[];
}

async function isNodeRunning(): Promise<boolean> {
	try {
		const result =
			await Bun.$`docker ps --format json --filter "name=stacks-blockchain"`.quiet();
		if (result.exitCode !== 0) return false;
		return result.stdout
			.toString()
			.trim()
			.split("\n")
			.filter(Boolean)
			.some((line) => {
				const { Status } = JSON.parse(line) as { Status?: string };
				return !Status?.includes("Restarting");
			});
	} catch {
		return false;
	}
}

export async function checkHealth(): Promise<HealthReport> {
	const issues: string[] = [];

	// Node health
	const node: NodeHealth = {
		running: false,
		network: null,
		height: null,
		burnHeight: null,
		chainId: null,
		peers: 0,
		version: null,
	};

	node.running = await isNodeRunning();

	if (node.running) {
		try {
			const res = await fetch("http://localhost:20443/v2/info", {
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				const info = (await res.json()) as {
					network_id: number;
					stacks_tip_height?: number;
					burn_block_height?: number;
					server_version?: string;
				};
				node.chainId = info.network_id;
				node.height = info.stacks_tip_height ?? null;
				node.burnHeight = info.burn_block_height ?? null;
				node.version = info.server_version ?? null;
				node.network = networkFromId(info.network_id);
			}
		} catch {
			issues.push("Node RPC not responding");
		}

		try {
			const res = await fetch("http://localhost:20443/v2/neighbors", {
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				const peers = (await res.json()) as {
					inbound?: unknown[];
					outbound?: unknown[];
				};
				node.peers =
					(peers.inbound?.length ?? 0) + (peers.outbound?.length ?? 0);
			}
		} catch {
			// ignore
		}
	}

	// Container health
	const containers: ContainerHealth[] = [];
	try {
		const result =
			await Bun.$`docker ps -a --format json --filter "name=stacks" --filter "name=secondlayer-dev"`
				.quiet()
				.nothrow();
		if (result.exitCode === 0) {
			const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const c = JSON.parse(line);
					const name = c.Names || c.Name;
					const status = c.Status || "unknown";
					let health = "unknown";
					if (status.includes("healthy")) health = "healthy";
					else if (status.includes("unhealthy")) health = "unhealthy";
					else if (status.includes("Up")) health = "running";
					else if (status.includes("Exited")) health = "exited";

					// Get restart count
					let restartCount = 0;
					try {
						const inspect =
							await Bun.$`docker inspect --format={{.RestartCount}} ${name}`
								.quiet()
								.nothrow();
						if (inspect.exitCode === 0) {
							restartCount =
								Number.parseInt(inspect.stdout.toString().trim()) || 0;
						}
					} catch {}

					containers.push({ name, status, health, restartCount });

					if (health === "unhealthy") {
						issues.push(`Container ${name} is unhealthy`);
					}
					if (restartCount > 3) {
						issues.push(
							`Container ${name} has restarted ${restartCount} times`,
						);
					}
				} catch {}
			}
		}
	} catch {}

	// Service health
	const services: ServiceHealth[] = [];
	const devState = await loadDevState();

	if (devState) {
		for (const [name, svc] of Object.entries(devState.services)) {
			const running = isProcessRunning(svc.pid);
			let responsive = false;

			if (running && svc.port) {
				try {
					const res = await fetch(`http://localhost:${svc.port}/health`, {
						signal: AbortSignal.timeout(2000),
					});
					responsive = res.ok;
				} catch {
					// Not responsive
				}
			}

			services.push({
				name,
				pid: svc.pid,
				port: svc.port,
				running,
				responsive: running && (!svc.port || responsive),
			});

			if (!running) {
				issues.push(`Service ${name} (pid ${svc.pid}) is not running`);
			} else if (svc.port && !responsive) {
				issues.push(
					`Service ${name} on port ${svc.port} is not responding to health checks`,
				);
			}
		}
	}

	// Infrastructure health
	const infrastructure: InfraHealth = { postgres: false };

	try {
		const pg = await Bun.$`docker ps -q -f name=secondlayer-dev-postgres`
			.quiet()
			.nothrow();
		infrastructure.postgres = pg.stdout.toString().trim().length > 0;
	} catch {}

	// Port conflict detection
	const portsToCheck = [
		{ port: 3800, name: "API" },
		{ port: 3700, name: "Indexer" },
		{ port: 20443, name: "Node RPC" },
	];

	for (const { port, name } of portsToCheck) {
		try {
			const result = await Bun.$`lsof -ti:${port} -sTCP:LISTEN`
				.quiet()
				.nothrow();
			const pids = [
				...new Set(result.stdout.toString().trim().split("\n").filter(Boolean)),
			];
			if (pids.length > 1) {
				issues.push(`Port ${port} (${name}) has multiple listeners`);
			}
		} catch {}
	}

	return { node, containers, services, infrastructure, issues };
}
