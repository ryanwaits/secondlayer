import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Subcommand } from "../lib/exec-cli.ts";
import { registerSetupTools } from "./setup.ts";

interface RegisteredTool {
	name: string;
	description: string;
	schema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		isError?: boolean;
	}>;
}

function fakeServer(tools: RegisteredTool[]): McpServer {
	return {
		tool: (
			name: string,
			description: string,
			schema: Record<string, unknown>,
			handler: RegisteredTool["handler"],
		) => {
			tools.push({ name, description, schema, handler });
		},
	} as unknown as McpServer;
}

describe("setup / bootstrap / repair MCP tools", () => {
	it("setup argv is an array, not a concatenated shell string", async () => {
		const tools: RegisteredTool[] = [];
		const calls: Array<{ sub: Subcommand; args: string[] }> = [];
		registerSetupTools(fakeServer(tools), async (sub, args) => {
			calls.push({ sub, args });
			return { code: 0, stdout: '{"ok":true}', stderr: "" };
		});

		const tool = tools.find((t) => t.name === "setup");
		expect(tool).toBeDefined();
		if (!tool) throw new Error("setup not registered");
		expect(tool.description).toContain("empty");
		expect(tool.description).toMatch(/metered/i);
		expect(tool.description).toContain("instance_status");
		expect(tool.description).toContain("archive_verify");
		expect(tool.description).not.toMatch(/\bconsume\b/);

		const result = await tool.handler({
			network: "mainnet",
			nodeMode: "external",
			against: "https://archive.secondlayer.tools/latest.json",
			dir: ".",
		});
		expect(result.isError).toBeUndefined();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.sub).toBe("setup");
		expect(Array.isArray(calls[0]?.args)).toBe(true);
		expect(calls[0]?.args).toEqual([
			"--yes",
			"--network",
			"mainnet",
			"--node-mode",
			"external",
			"--against",
			"https://archive.secondlayer.tools/latest.json",
			"--dir",
			".",
		]);
		expect(calls[0]?.args.join(" ")).not.toContain(";");
	});

	it("archive_bootstrap argv includes --against --yes --json", async () => {
		const tools: RegisteredTool[] = [];
		const calls: Array<{ sub: Subcommand; args: string[] }> = [];
		registerSetupTools(fakeServer(tools), async (sub, args) => {
			calls.push({ sub, args });
			return { code: 0, stdout: "{}", stderr: "" };
		});

		const tool = tools.find((t) => t.name === "archive_bootstrap");
		if (!tool) throw new Error("archive_bootstrap not registered");
		expect(tool.description).toMatch(/metered/i);
		expect(tool.description).toContain("instance_status");
		expect(tool.description).toContain("archive_verify");

		await tool.handler({
			against: "https://archive.secondlayer.tools/latest.json",
			fromBlock: 100,
			toBlock: 200,
		});
		expect(calls[0]?.sub).toBe("bootstrap");
		expect(calls[0]?.args).toEqual([
			"--against",
			"https://archive.secondlayer.tools/latest.json",
			"--yes",
			"--json",
			"--from-block",
			"100",
			"--to-block",
			"200",
		]);
	});

	it("archive_repair is plan-only unless apply, then adds --apply --yes", async () => {
		const tools: RegisteredTool[] = [];
		const calls: Array<{ sub: Subcommand; args: string[] }> = [];
		registerSetupTools(fakeServer(tools), async (sub, args) => {
			calls.push({ sub, args });
			return { code: 0, stdout: "{}", stderr: "" };
		});

		const tool = tools.find((t) => t.name === "archive_repair");
		if (!tool) throw new Error("archive_repair not registered");

		await tool.handler({
			against: "https://archive.secondlayer.tools/latest.json",
		});
		expect(calls[0]?.args).toEqual([
			"--against",
			"https://archive.secondlayer.tools/latest.json",
			"--json",
		]);
		expect(calls[0]?.args).not.toContain("--apply");

		await tool.handler({
			against: "https://archive.secondlayer.tools/latest.json",
			apply: true,
		});
		expect(calls[1]?.args).toEqual([
			"--against",
			"https://archive.secondlayer.tools/latest.json",
			"--json",
			"--apply",
			"--yes",
		]);
	});

	it("rejects injection before spawn when exec-cli is the default", async () => {
		const { execSecondlayer } = await import("../lib/exec-cli.ts");
		await expect(execSecondlayer("bootstrap", ["; rm -rf /"])).rejects.toThrow(
			/rejected argument/,
		);
	});
});
