/** Summarize a stream for list responses. */
export function formatStreamSummary(s: {
	id: string;
	name: string;
	status: string;
	endpointUrl: string;
	totalDeliveries: number;
	failedDeliveries: number;
}) {
	return {
		id: s.id,
		name: s.name,
		status: s.status,
		endpointUrl: s.endpointUrl,
		totalDeliveries: s.totalDeliveries,
		failedDeliveries: s.failedDeliveries,
	};
}

/** Summarize a subgraph for list responses. */
export function formatSubgraphSummary(s: {
	name: string;
	status: string;
	tables: string[] | Record<string, unknown>;
	lastProcessedBlock: number;
}) {
	return {
		name: s.name,
		status: s.status,
		tables: Array.isArray(s.tables) ? s.tables : Object.keys(s.tables),
		lastProcessedBlock: s.lastProcessedBlock,
	};
}

/** Summarize delivery for list responses. */
export function formatDeliverySummary(d: {
	id: string;
	blockHeight: number;
	status: string;
	statusCode: number | null;
	attempts: number;
	createdAt: string;
}) {
	return {
		id: d.id,
		blockHeight: d.blockHeight,
		status: d.status,
		statusCode: d.statusCode,
		attempts: d.attempts,
		createdAt: d.createdAt,
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
