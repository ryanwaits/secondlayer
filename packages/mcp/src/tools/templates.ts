import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { templates, getTemplateById, getTemplatesByCategory } from "@secondlayer/subgraphs/templates";
import { defineTool } from "../lib/tool.ts";

export function registerTemplateTools(server: McpServer) {
  defineTool<{ category?: string }>(
    server,
    "templates_list",
    "List available subgraph templates. Returns metadata only — use templates_get for full code.",
    { category: z.enum(["defi", "nft", "token", "infrastructure"]).optional().describe("Filter by category") },
    async ({ category }) => {
      const list = category ? getTemplatesByCategory(category) : templates;
      return {
        content: [{
          type: "text",
          text: JSON.stringify(list.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
          })), null, 2),
        }],
      };
    },
  );

  defineTool<{ id: string }>(
    server,
    "templates_get",
    "Get a template's full code and prompt by ID.",
    { id: z.string().describe("Template ID (e.g. 'dex-swaps')") },
    async ({ id }) => {
      const template = getTemplateById(id);
      if (!template) {
        return { content: [{ type: "text", text: `Template "${id}" not found. Use templates_list to see available templates.` }], isError: true };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ id: template.id, name: template.name, description: template.description, category: template.category, code: template.code, prompt: template.prompt }, null, 2),
        }],
      };
    },
  );
}
