import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SecondLayer } from "@secondlayer/sdk";
import { getRegisteredToolNames, restrictTools } from "./lib/tool.ts";
import { buildContext } from "./resources.ts";
import { createServer } from "./server.ts";
import { TOOL_GROUPS, isHostedTool } from "./tool-groups.ts";

/** The tools the hosted MCP endpoint serves. A new tool changes this list on
 *  purpose: decide whether it may run on the hosted API, then update it. */
const HOSTED_TOOLS = [
	"account_whoami",
	"batch_query",
	"contracts_find",
	"contracts_get_abi",
	"index_blocks",
	"index_contract_calls",
	"index_discover",
	"index_events",
	"index_ft_transfers",
	"index_nft_transfers",
	"index_print_schema",
	"index_transactions",
	"streams_dumps",
	"streams_tip",
	"subgraphs_scaffold",
];

const fakeClient = {} as SecondLayer;
const hostedServer = () =>
	createServer({
		hosted: true,
		clientProvider: () => fakeClient,
		archiveOpsClientProvider: () => fakeClient,
		apiRequest: async <T>() => ({ email: "x@example.com" }) as T,
	});
const names = (s: McpServer) =>
	Object.keys(
		(s as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools,
	).sort();

describe("hosted tool set", () => {
	it("is exactly the hosted list", () => {
		expect(names(hostedServer())).toEqual(HOSTED_TOOLS);
	});

	it("never mints keys, deploys, delivers webhooks, spawns the CLI or diagnoses an instance", () => {
		for (const name of names(hostedServer())) {
			expect(name).not.toBe("account_create_key");
			expect(name).not.toMatch(/^(webhooks_|archive_|codegen|instance)/);
			if (name.startsWith("subgraphs_"))
				expect(name).toBe("subgraphs_scaffold");
		}
	});

	it("each tool's group decides it, and the per-server registry matches", () => {
		const server = hostedServer();
		expect(getRegisteredToolNames(server).sort()).toEqual(HOSTED_TOOLS);
		const decided = TOOL_GROUPS.flatMap((g) => {
			const s = new McpServer({ name: "t", version: "0" });
			// Restricted (to everything) so the process-wide registry, which
			// other suites assert on, is left alone.
			restrictTools(s, () => true);
			g.register(s);
			return names(s).filter((n) => isHostedTool(g, n));
		}).sort();
		expect(decided).toEqual(HOSTED_TOOLS);
	});

	it("tools use the injected client and request, not env", async () => {
		const calls: string[] = [];
		const server = createServer({
			hosted: true,
			clientProvider: () =>
				({
					streams: {
						tip: async () => {
							calls.push("tip");
							return { block_height: 7 };
						},
					},
				}) as unknown as SecondLayer,
			apiRequest: async <T>(method: string, path: string) => {
				calls.push(`${method} ${path}`);
				return { email: "me@example.com" } as T;
			},
		});
		const tools = (
			server as unknown as {
				_registeredTools: Record<
					string,
					{ handler: (a: unknown) => Promise<{ content: { text: string }[] }> }
				>;
			}
		)._registeredTools;
		const tip = await tools.streams_tip.handler({});
		expect(tip.content[0].text).toContain("7");
		const who = await tools.account_whoami.handler({});
		expect(who.content[0].text).toContain("me@example.com");
		expect(calls).toEqual(["tip", "GET /api/accounts/me"]);
	});

	it("the hosted context names the caller's credential and lists only hosted tools", async () => {
		const server = hostedServer();
		const ctx = await buildContext({
			clientProvider: () =>
				({ context: async () => null }) as unknown as SecondLayer,
			hosted: true,
			server,
		});
		expect(ctx.authState.apiKeySet).toBe(true);
		const listed = ctx.whatYouCanDo.products.join(" ");
		expect(listed).toContain("index_events");
		expect(listed).not.toContain("account_create_key");
		expect(listed).not.toContain("webhooks_create");
		expect(JSON.stringify(ctx.readAuthTiers)).toContain("OAuth");
	});

	it("the docs tool list marks which tools are remote", () => {
		const generated = JSON.parse(
			readFileSync(
				join(import.meta.dir, "../../../apps/web/src/generated/mcp-tools.json"),
				"utf8",
			),
		) as { tools: { name: string; remote?: boolean }[] };
		for (const t of generated.tools)
			expect(typeof t.remote, t.name).toBe("boolean");
		expect(
			generated.tools
				.filter((t) => t.remote)
				.map((t) => t.name)
				.sort(),
		).toEqual(HOSTED_TOOLS);
	});
});
