/**
 * The audience rule for OAuth access tokens (`oat-sl_`): they are valid only
 * on requests the hosted MCP handler made itself, in process. Only the MCP
 * dispatcher (routes/mcp.ts) marks a request, and `/v1/batch` passes the mark
 * on to the items of a batch that was itself marked. A request received from
 * the network is never in the set, so an app's token sent straight to `/v1`
 * or `/api` resolves to nothing and gets a 401.
 */
const mcpRequests = new WeakSet<Request>();

export function markMcpRequest(req: Request): void {
	mcpRequests.add(req);
}

export function isMcpRequest(req: Request | undefined): boolean {
	return req !== undefined && mcpRequests.has(req);
}
