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
	keys: {
		all: ["keys"] as const,
	},
	insights: {
		all: ["insights"] as const,
		byCategory: (category: string) => ["insights", category] as const,
		byResource: (category: string, resourceId: string) =>
			["insights", category, resourceId] as const,
	},
	marketplace: {
		browse: (params: string) => ["marketplace", "browse", params] as const,
		detail: (name: string) => ["marketplace", "detail", name] as const,
		creator: (slug: string) => ["marketplace", "creator", slug] as const,
	},
	status: ["status"] as const,
	admin: {
		waitlist: (status?: string) => ["admin", "waitlist", status] as const,
		accounts: ["admin", "accounts"] as const,
		stats: ["admin", "stats"] as const,
	},
	projects: {
		all: ["projects"] as const,
		detail: (slug: string) => ["projects", slug] as const,
		team: (slug: string) => ["projects", slug, "team"] as const,
	},
};
