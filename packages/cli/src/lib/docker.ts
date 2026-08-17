/**
 * Docker availability helpers
 */

import { spawnSync } from "node:child_process";

export class DockerNotAvailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DockerNotAvailableError";
	}
}

// child_process (not `Bun.$`) so this works under both node and bun — the
// published CLI runs under node via its shebang, where `Bun.$` doesn't exist
// and every call below silently reported Docker as unreachable regardless of
// its actual state. Same fix `devnet.ts`'s `ensureDocker` and
// `setup-wizard.ts`'s `checkDocker` already apply, for the same reason.
function run(command: string, args: string[]): { ok: boolean; stdout: string } {
	const result = spawnSync(command, args, { encoding: "utf8" });
	return {
		ok: !result.error && result.status === 0,
		stdout: result.stdout ?? "",
	};
}

/**
 * Check if Docker is available and running
 */
export async function isDockerAvailable(): Promise<boolean> {
	return run("docker", ["info"]).ok;
}

/**
 * Require Docker to be available, throw helpful error if not
 */
export async function requireDocker(): Promise<void> {
	// First check if docker command exists
	if (!run("which", ["docker"]).ok) {
		throw new DockerNotAvailableError(
			"Docker is not installed.\n\n" +
				"Install Docker:\n" +
				"  macOS:  brew install --cask docker\n" +
				"          or download from https://docker.com/products/docker-desktop\n" +
				"  Linux:  curl -fsSL https://get.docker.com | sh\n",
		);
	}

	// Check if Docker daemon is running
	const available = await isDockerAvailable();
	if (!available) {
		throw new DockerNotAvailableError(
			"Docker daemon is not running.\n\n" +
				"Start Docker:\n" +
				"  macOS:  Open Docker Desktop or OrbStack\n" +
				"  Linux:  sudo systemctl start docker\n",
		);
	}
}

/**
 * Check if a container is running
 */
export async function isContainerRunning(name: string): Promise<boolean> {
	return (
		run("docker", ["ps", "-q", "-f", `name=${name}`]).stdout.trim().length > 0
	);
}

/**
 * Check if a container exists (running or stopped)
 */
export async function containerExists(name: string): Promise<boolean> {
	return (
		run("docker", ["ps", "-aq", "-f", `name=${name}`]).stdout.trim().length > 0
	);
}

/**
 * Stop and remove a container
 */
export async function removeContainer(name: string): Promise<void> {
	run("docker", ["stop", name]);
	run("docker", ["rm", name]);
}
