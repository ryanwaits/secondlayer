import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

/**
 * Type-safe wrapper around McpServer.tool() that avoids TS2589.
 *
 * The MCP SDK's Zod-generic `tool()` signature recurses past TypeScript's
 * instantiation depth limit when schemas contain discriminated unions or
 * nested optionals. This helper isolates the boundary cast to one place
 * so tool files stay fully typed via the explicit `T` generic.
 *
 * Schema is typed as Record<string, unknown> to prevent TypeScript from
 * resolving the deeply recursive ZodRawShapeCompat constraint. Zod still
 * validates at runtime.
 */
export function defineTool<T>(
	server: McpServer,
	name: string,
	description: string,
	schema: Record<string, unknown>,
	handler: (args: T) => Promise<ToolResult> | ToolResult,
): void {
	const wrappedHandler = async (args: T): Promise<ToolResult> => {
		try {
			return await handler(args);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			const status =
				// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
				err instanceof Error && "status" in err ? (err as any).status : 0;
			const type =
				status === 401
					? "unauthorized"
					: status === 404
						? "not_found"
						: status === 429
							? "rate_limited"
							: status >= 500
								? "server_error"
								: "error";
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ error: { type, status, message } }),
					},
				],
				isError: true,
			};
		}
	};
	(server.tool as (...args: unknown[]) => unknown)(
		name,
		description,
		schema,
		wrappedHandler,
	);
}
