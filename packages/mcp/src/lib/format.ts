/** Summarize a subgraph for list responses. */
export function formatSubgraphSummary(s: {
	name: string;
	status: string;
	tables: string[] | Record<string, unknown>;
	lastProcessedBlock: number;
	visibility?: "public" | "private";
}) {
	const apiUrl =
		process.env.SECONDLAYER_API_URL || "https://api.secondlayer.tools";
	return {
		name: s.name,
		status: s.status,
		tables: Array.isArray(s.tables) ? s.tables : Object.keys(s.tables),
		lastProcessedBlock: s.lastProcessedBlock,
		...(s.visibility ? { visibility: s.visibility } : {}),
		// Public subgraphs are anon-readable — surface the shareable /v1 URL.
		...(s.visibility === "public"
			? { publicUrl: `${apiUrl}/v1/subgraphs/${s.name}` }
			: {}),
	};
}

/** Cap array length and return truncation metadata. */
export function withCap<T>(
	items: T[],
	cap: number,
): { items: T[]; truncated: boolean; total: number } {
	return {
		items: items.slice(0, cap),
		truncated: items.length > cap,
		total: items.length,
	};
}

/** Build MCP text response with JSON-serialized payload. */
export function jsonResponse(
	data: unknown,
	isError?: boolean,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
	return {
		content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
		...(isError && { isError: true }),
	};
}

/** Build MCP text response with plain text payload. */
export function textResponse(
	text: string,
	isError?: boolean,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
	return {
		content: [{ type: "text", text }],
		...(isError && { isError: true }),
	};
}
