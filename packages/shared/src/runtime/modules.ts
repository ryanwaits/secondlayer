/**
 * Lifecycle modules — each runtime plane exposes start/stop/health so a
 * supervisor can restart one without taking the others down.
 */

import { defineMachine } from "../db/transition.ts";

export const MODULE_IDS = [
	"api",
	"ingest",
	"decoder",
	"subgraph",
	"notification",
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

/**
 * Legal module moves. `starting` is only entered from `stopped` or `failed`,
 * so a second `start` of a live module is a no-op instead of a double start;
 * every state can be stopped except `stopped` itself.
 */
export const MODULE_MACHINE = defineMachine({
	states: MODULE_STATES,
	transitions: {
		stopped: ["starting"],
		starting: ["running", "degraded", "failed", "stopped"],
		running: ["degraded", "failed", "stopped"],
		degraded: ["running", "failed", "stopped"],
		failed: ["starting", "stopped"],
	},
});

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
