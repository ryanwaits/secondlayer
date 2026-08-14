// Query key factory — single source of truth for cache keys
export const queryKeys = {
	subgraphs: {
		all: ["subgraphs"] as const,
		data: (name: string, table: string, page: number) =>
			["subgraph-data", name, table, page] as const,
	},
};
