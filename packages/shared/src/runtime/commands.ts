/**
 * Child-process commands the one-box supervisor starts.
 * Publisher stays off the default profile.
 */

import type { ModuleId } from "./modules.ts";

export const MODULE_COMMANDS: Record<ModuleId, readonly string[]> = {
	api: ["bun", "run", "packages/api/src/index.ts"],
	ingest: ["bun", "run", "packages/indexer/src/index.ts"],
	decoder: ["bun", "run", "packages/indexer/src/decode/service.ts"],
	subgraph: ["bun", "run", "packages/subgraphs/src/service.ts"],
	notification: [
		"bun",
		"run",
		"packages/subgraphs/src/subscription-service.ts",
	],
	verification: ["bun", "run", "packages/shared/src/runtime/verify-loop.ts"],
	publisher: ["bun", "run", "packages/indexer/src/streams-bulk/scheduler.ts"],
};

export function commandFor(id: ModuleId): readonly string[] {
	return MODULE_COMMANDS[id];
}
