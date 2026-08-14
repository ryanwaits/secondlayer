// Query key factory — single source of truth for cache keys
export const queryKeys = {
	subgraphs: {
		all: ["subgraphs"] as const,
		detail: (name: string) => ["subgraphs", name] as const,
		tableData: (name: string, table: string) =>
			["subgraphs", name, "tableData", table] as const,
		tableDataPage: (name: string, table: string, page: number) =>
			["subgraphs", name, "tableData", table, page] as const,
	},
	status: ["status"] as const,
};
