/**
 * Measure the box the runtime is actually running on, so the guardrail floors
 * in `guardrails.ts` can be enforced instead of merely documented.
 *
 * Two decisions here are load-bearing and easy to get backwards:
 *
 * 1. Disk is measured as TOTAL filesystem capacity, never free space. A healthy
 *    mainnet instance legitimately occupies most of its disk — checking free
 *    space would refuse to restart the very installs that are working, which is
 *    a far worse failure than the undersizing this guards against.
 *
 * 2. An unmeasurable dimension is reported as unknown and skipped, never
 *    treated as zero. Failing to boot because `statfs` was unavailable would
 *    turn a diagnostic into an outage.
 *
 * Attribution caveat: in the shipped one-box compose, Postgres and the runtime
 * hold separate Docker named volumes that share one host filesystem, so the
 * filesystem behind DATA_DIR is a sound proxy for where the index will land.
 * An operator who deliberately bind-mounts the database onto a different disk
 * is measuring the wrong volume — which is why undersizing warns loudly and
 * stays overridable rather than being treated as ground truth.
 */
import { statfs } from "node:fs/promises";
import { totalmem } from "node:os";
import type { ResourceSnapshot } from "./guardrails.ts";

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

export type MeasuredResources = {
	snapshot: Partial<ResourceSnapshot>;
	/** Dimensions we could not read, with why. Never guessed at. */
	unknown: string[];
};

export async function measureRamMb(): Promise<number | null> {
	try {
		const total = totalmem();
		return total > 0 ? Math.floor(total / BYTES_PER_MB) : null;
	} catch {
		return null;
	}
}

/** Total capacity of the filesystem holding `path`. Not free space — see above. */
export async function measureDiskGb(path: string): Promise<number | null> {
	try {
		const stats = await statfs(path);
		const totalBytes = Number(stats.blocks) * Number(stats.bsize);
		return totalBytes > 0 ? Math.floor(totalBytes / BYTES_PER_GB) : null;
	} catch {
		return null;
	}
}

/**
 * `max_connections` as Postgres reports it. Takes an executor rather than
 * importing the db module so this stays unit-testable without a database.
 */
export async function measurePostgresMaxConnections(
	query: (sql: string) => Promise<Array<Record<string, unknown>>>,
): Promise<number | null> {
	try {
		const rows = await query("SHOW max_connections");
		const raw = rows[0]?.max_connections;
		const value = Number(raw);
		return Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		return null;
	}
}

export async function measureResources(input: {
	dataDir: string;
	query?: (sql: string) => Promise<Array<Record<string, unknown>>>;
}): Promise<MeasuredResources> {
	const unknown: string[] = [];
	const snapshot: Partial<ResourceSnapshot> = {};

	const ramMb = await measureRamMb();
	if (ramMb === null) unknown.push("RAM");
	else snapshot.ramMb = ramMb;

	const diskGb = await measureDiskGb(input.dataDir);
	if (diskGb === null) unknown.push(`disk (${input.dataDir} unreadable)`);
	else snapshot.diskGb = diskGb;

	if (input.query) {
		const conns = await measurePostgresMaxConnections(input.query);
		if (conns === null) unknown.push("Postgres max_connections");
		else snapshot.postgresMaxConnections = conns;
	} else {
		unknown.push("Postgres max_connections (no database handle)");
	}

	return { snapshot, unknown };
}
