import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectTools } from "./projects.ts";

interface RegisteredTool {
	name: string;
	handler: (args: Record<string, unknown>) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		isError?: boolean;
	}>;
}

function fakeServer(tools: RegisteredTool[]): McpServer {
	return {
		tool: (
			name: string,
			_description: string,
			_schema: Record<string, unknown>,
			handler: RegisteredTool["handler"],
		) => {
			tools.push({ name, handler });
		},
	} as unknown as McpServer;
}

function setup(projects: Record<string, unknown>) {
	const tools: RegisteredTool[] = [];
	registerProjectTools(
		fakeServer(tools),
		() =>
			({ projects }) as unknown as ReturnType<
				typeof import("../lib/client.ts").getClient
			>,
	);
	return tools;
}

describe("project MCP tools", () => {
	it("registers the full project CRUD + team surface", () => {
		const tools = setup({});
		expect(tools.map((t) => t.name).sort()).toEqual([
			"project_create",
			"project_delete",
			"project_get",
			"project_list",
			"project_team_list",
			"project_update",
		]);
	});

	it("project_create delegates to projects.create", async () => {
		let captured: unknown;
		const tools = setup({
			create: async (params: unknown) => {
				captured = params;
				return { id: "p1", slug: "my-app" };
			},
		});
		const create = tools.find((t) => t.name === "project_create");
		const res = await create?.handler({ name: "My App", network: "mainnet" });
		expect(captured).toEqual({
			name: "My App",
			slug: undefined,
			network: "mainnet",
			nodeRpc: undefined,
		});
		expect(res?.content[0]?.text).toContain("my-app");
	});

	it("project_update maps newSlug → body.slug (rename) and drops undefined", async () => {
		let captured: { slug: string; patch: unknown } | undefined;
		const tools = setup({
			update: async (slug: string, patch: unknown) => {
				captured = { slug, patch };
				return { id: "p1", slug: "renamed" };
			},
		});
		const update = tools.find((t) => t.name === "project_update");
		await update?.handler({ slug: "my-app", newSlug: "renamed" });
		expect(captured).toEqual({ slug: "my-app", patch: { slug: "renamed" } });
	});

	it("project_team_list delegates to projects.team", async () => {
		let teamedSlug: string | undefined;
		const tools = setup({
			team: async (slug: string) => {
				teamedSlug = slug;
				return { members: [], invitations: [] };
			},
		});
		const team = tools.find((t) => t.name === "project_team_list");
		const res = await team?.handler({ slug: "my-app" });
		expect(teamedSlug).toBe("my-app");
		expect(res?.content[0]?.text).toContain("members");
	});
});
