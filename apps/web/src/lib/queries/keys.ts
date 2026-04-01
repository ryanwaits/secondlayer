// Query key factory — single source of truth for cache keys
export const queryKeys = {
	streams: {
		all: ["streams"] as const,
		detail: (id: string) => ["streams", id] as const,
		deliveries: (id: string) => ["streams", id, "deliveries"] as const,
		deliveriesPage: (id: string, page: number) =>
			["streams", id, "deliveries", page] as const,
	},
	subgraphs: {
		all: ["subgraphs"] as const,
		detail: (name: string) => ["subgraphs", name] as const,
		tableData: (name: string, table: string) =>
			["subgraphs", name, "tableData", table] as const,
		tableDataPage: (name: string, table: string, page: number) =>
			["subgraphs", name, "tableData", table, page] as const,
	},
	keys: {
		all: ["keys"] as const,
	},
	insights: {
		all: ["insights"] as const,
		byCategory: (category: string) => ["insights", category] as const,
		byResource: (category: string, resourceId: string) =>
			["insights", category, resourceId] as const,
	},
	status: ["status"] as const,
};
