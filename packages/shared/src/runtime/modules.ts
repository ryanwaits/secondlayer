/**
 * Lifecycle modules — each runtime plane exposes start/stop/health so a
 * supervisor can restart one without taking the others down.
 */

export const MODULE_IDS = [
	"api",
	"ingest",
	"decoder",
	"subgraph",
	"notification",
	"verification",
	"publisher",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const MODULE_STATES = [
	"stopped",
	"starting",
	"running",
	"degraded",
	"failed",
] as const;
export type ModuleState = (typeof MODULE_STATES)[number];

export type ModuleHealth = {
	id: ModuleId;
	state: ModuleState;
	detail: string | null;
	restarts: number;
};

export type RuntimeModule = {
	id: ModuleId;
	start: () => Promise<void>;
	stop: () => Promise<void>;
	health: () => ModuleHealth;
};

export const DEFAULT_PROFILE: readonly ModuleId[] = [
	"api",
	"ingest",
	"decoder",
	"subgraph",
	"notification",
	"verification",
];

export const PUBLISHER_PROFILE: readonly ModuleId[] = ["publisher"];

export function isModuleId(value: string): value is ModuleId {
	return (MODULE_IDS as readonly string[]).includes(value);
}

export function emptyHealth(id: ModuleId): ModuleHealth {
	return { id, state: "stopped", detail: null, restarts: 0 };
}

/** In-memory module used by restart/fault tests. */
export function createMemoryModule(
	id: ModuleId,
	opts?: {
		failStart?: boolean;
		loop?: boolean;
		onStart?: () => void;
		onStop?: () => void;
	},
): RuntimeModule & { setState: (state: ModuleState, detail?: string) => void } {
	let health = emptyHealth(id);
	return {
		id,
		setState(state, detail) {
			health = { ...health, state, detail: detail ?? health.detail };
		},
		async start() {
			if (opts?.failStart) {
				health = {
					...health,
					state: "failed",
					detail: "start failed",
				};
				throw new Error(`${id} start failed`);
			}
			opts?.onStart?.();
			health = {
				...health,
				state: opts?.loop ? "failed" : "running",
				detail: opts?.loop ? "loop contained" : null,
				restarts: health.restarts,
			};
			if (opts?.loop) throw new Error(`${id} loop`);
		},
		async stop() {
			opts?.onStop?.();
			health = { ...health, state: "stopped" };
		},
		health: () => health,
	};
}
