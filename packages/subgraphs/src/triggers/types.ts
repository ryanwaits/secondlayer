import type { SubgraphFilter } from "../types.ts";

export interface EventTrigger {
	type: "event";
	filter: SubgraphFilter;
}
