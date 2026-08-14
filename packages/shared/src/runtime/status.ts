/**
 * Status UX — node, raw, decoder, subgraph, queue, archive import, disk,
 * and coverage, each with a next action.
 */

import type { CoverageState } from "../coverage/evaluate.ts";
import type { ModuleHealth, ModuleId } from "./modules.ts";
import type { SupervisorHealth } from "./supervisor.ts";

export const STATUS_PLANES = [
	"node",
	"raw",
	"decoder",
	"subgraph",
	"queue",
	"archive",
	"disk",
	"coverage",
] as const;
export type StatusPlane = (typeof STATUS_PLANES)[number];

export type PlaneStatus = {
	plane: StatusPlane;
	state: string;
	action: string;
};

export type RuntimeStatusReport = {
	status: SupervisorHealth["status"];
	modules: ModuleHealth[];
	planes: PlaneStatus[];
};

const MODULE_TO_PLANE: Partial<Record<ModuleId, StatusPlane>> = {
	ingest: "raw",
	decoder: "decoder",
	subgraph: "subgraph",
	notification: "queue",
	verification: "coverage",
};

export function reportRuntimeStatus(input: {
	supervisor: SupervisorHealth;
	node?: string;
	archive?: string;
	disk?: string;
	coverage?: CoverageState | string;
}): RuntimeStatusReport {
	const planes: PlaneStatus[] = [];
	planes.push({
		plane: "node",
		state: input.node ?? "unknown",
		action: actionFor("node", input.node ?? "unknown"),
	});
	for (const mod of input.supervisor.modules) {
		const plane = MODULE_TO_PLANE[mod.id];
		if (!plane) continue;
		planes.push({
			plane,
			state: mod.state,
			action: actionFor(plane, mod.state),
		});
	}
	planes.push({
		plane: "archive",
		state: input.archive ?? "idle",
		action: actionFor("archive", input.archive ?? "idle"),
	});
	planes.push({
		plane: "disk",
		state: input.disk ?? "ok",
		action: actionFor("disk", input.disk ?? "ok"),
	});
	planes.push({
		plane: "coverage",
		state: input.coverage ?? "unknown",
		action: actionFor("coverage", String(input.coverage ?? "unknown")),
	});
	return {
		status: input.supervisor.status,
		modules: input.supervisor.modules,
		planes,
	};
}

export function actionFor(plane: StatusPlane, state: string): string {
	if (state === "running" || state === "ok" || state === "complete") {
		return "none";
	}
	if (state === "failed" || state === "gap") {
		return plane === "raw" || plane === "coverage"
			? "sl verify all --against <manifest>"
			: `restart ${plane}`;
	}
	if (state === "lagging" || state === "syncing") return "wait for catch-up";
	if (state === "stale") return "refresh source tip";
	if (plane === "archive" && state === "idle")
		return "sl bootstrap --against <manifest>";
	if (plane === "disk" && state !== "ok") return "free disk and retry";
	if (plane === "node" && state === "unknown") return "sl observer";
	return "inspect logs";
}
