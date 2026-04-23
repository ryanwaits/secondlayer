import type { SubgraphFilter } from "@secondlayer/subgraphs/types";

export interface EventTrigger {
	type: "event";
	filter: SubgraphFilter;
}
