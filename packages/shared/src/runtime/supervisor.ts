/**
 * Unified supervisor — start a profile, contain per-module faults, aggregate
 * health so unrelated reads stay up when one loop dies.
 */

import {
	type ModuleHealth,
	type ModuleId,
	type RuntimeModule,
	emptyHealth,
} from "./modules.ts";

export type SupervisorHealth = {
	status: "healthy" | "degraded" | "failed";
	modules: ModuleHealth[];
};

export type Supervisor = {
	start: (ids?: readonly ModuleId[]) => Promise<void>;
	stop: (id?: ModuleId) => Promise<void>;
	restart: (id: ModuleId) => Promise<void>;
	health: () => SupervisorHealth;
};

export function createSupervisor(
	modules: readonly RuntimeModule[],
): Supervisor {
	const byId = new Map(modules.map((m) => [m.id, m]));
	const selected = new Set<ModuleId>();
	const restarts = new Map<ModuleId, number>();

	function snapshot(): ModuleHealth[] {
		return [...byId.values()].map((mod) => {
			const health = selected.has(mod.id) ? mod.health() : emptyHealth(mod.id);
			return { ...health, restarts: restarts.get(mod.id) ?? health.restarts };
		});
	}

	function aggregate(list: ModuleHealth[]): SupervisorHealth["status"] {
		const live = list.filter((m) => selected.has(m.id));
		if (live.length === 0) return "failed";
		if (live.every((m) => m.state === "failed" || m.state === "stopped")) {
			return "failed";
		}
		if (live.some((m) => m.state === "failed" || m.state === "degraded")) {
			return "degraded";
		}
		if (live.every((m) => m.state === "running")) return "healthy";
		return "degraded";
	}

	return {
		async start(ids) {
			const targets = ids ?? [...byId.keys()];
			for (const id of targets) {
				const mod = byId.get(id);
				if (!mod) continue;
				selected.add(id);
				try {
					await mod.start();
				} catch {
					// contained — other modules still start
				}
			}
		},
		async stop(id) {
			if (id) {
				const mod = byId.get(id);
				if (mod && selected.has(id)) await mod.stop();
				selected.delete(id);
				return;
			}
			for (const mid of [...selected]) {
				const mod = byId.get(mid);
				if (mod) await mod.stop();
				selected.delete(mid);
			}
		},
		async restart(id) {
			const mod = byId.get(id);
			if (!mod) throw new Error(`unknown module ${id}`);
			if (selected.has(id)) await mod.stop();
			selected.add(id);
			restarts.set(id, (restarts.get(id) ?? 0) + 1);
			try {
				await mod.start();
			} catch {
				// contained
			}
		},
		health() {
			const modules = snapshot();
			return { status: aggregate(modules), modules };
		},
	};
}
