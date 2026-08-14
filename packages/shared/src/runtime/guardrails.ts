/**
 * Resource guardrails — preflight RAM/disk/Postgres and estimate growth.
 * Constrained fixtures fail early.
 */

export type ResourceSnapshot = {
	ramMb: number;
	diskGb: number;
	postgresMaxConnections: number;
	postgresSharedBuffersMb?: number;
};

export type GuardrailResult =
	| { ok: true; estimates: { diskGbPer100kBlocks: number } }
	| { ok: false; errors: string[] };

export const FLOORS = {
	appRamMb: 4096,
	fullRamMb: 98304,
	appDiskGb: 80,
	fullDiskGb: 1500,
	postgresMaxConnections: 50,
} as const;

export function preflightResources(
	snap: ResourceSnapshot,
	mode: "external" | "stacks" | "full",
): GuardrailResult {
	const errors: string[] = [];
	const ramFloor = mode === "full" ? FLOORS.fullRamMb : FLOORS.appRamMb;
	const diskFloor = mode === "full" ? FLOORS.fullDiskGb : FLOORS.appDiskGb;
	if (snap.ramMb < ramFloor) {
		errors.push(
			`RAM ${snap.ramMb}MB below ${ramFloor}MB for NODE_MODE=${mode}`,
		);
	}
	if (snap.diskGb < diskFloor) {
		errors.push(
			`disk ${snap.diskGb}GB below ${diskFloor}GB for NODE_MODE=${mode}`,
		);
	}
	if (snap.postgresMaxConnections < FLOORS.postgresMaxConnections) {
		errors.push(
			`Postgres max_connections ${snap.postgresMaxConnections} below ${FLOORS.postgresMaxConnections}`,
		);
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, estimates: { diskGbPer100kBlocks: 1 } };
}
