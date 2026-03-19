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
  (server.tool as Function)(name, description, schema, handler);
}
