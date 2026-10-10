import { describe, expect, it } from "bun:test";

const SRC = import.meta.dir;

interface Registered {
	server: string[];
	nonHosted: string[];
	hostedOnly: string[];
}

// A child process per base URL: createServer() reads the base URL from env, and
// each group registers into its own throwaway server so the expected set never
// comes from createServer() itself.
async function registered(baseUrl: string | undefined): Promise<Registered> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (
			value !== undefined &&
			key !== "SECONDLAYER_API_URL" &&
			key !== "SL_API_URL"
		) {
			env[key] = value;
		}
	}
	if (baseUrl) env.SECONDLAYER_API_URL = baseUrl;

	const proc = Bun.spawn(
		[
			"bun",
			"-e",
			`import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from ${JSON.stringify(`${SRC}/server.ts`)};
import { TOOL_GROUPS } from ${JSON.stringify(`${SRC}/tool-groups.ts`)};
const names = (s) => Object.keys(s._registeredTools).sort();
const group = (hostedOnly) => TOOL_GROUPS
	.filter((g) => Boolean(g.hostedOnly) === hostedOnly)
	.flatMap((g) => {
		const s = new McpServer({ name: "t", version: "0" });
		g.register(s);
		return names(s);
	})
	.sort();
process.stdout.write(JSON.stringify({
	server: names(createServer()),
	nonHosted: group(false),
	hostedOnly: group(true),
}));`,
		],
		{ env, stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0)
		throw new Error(`child failed (${code}): ${stderr || stdout}`);
	return JSON.parse(stdout) as Registered;
}

describe("TOOL_GROUPS", () => {
	it("createServer on a self-hosted base registers exactly the non-hosted groups", async () => {
		const { server, nonHosted, hostedOnly } = await registered(undefined);
		expect(server).toEqual(nonHosted);
		expect(hostedOnly.length).toBeGreaterThan(0);
		for (const name of hostedOnly) expect(server).not.toContain(name);
	});

	it("createServer on the hosted base adds the hosted-only groups", async () => {
		const { server, nonHosted, hostedOnly } = await registered(
			"https://api.secondlayer.tools",
		);
		expect(server).toEqual([...nonHosted, ...hostedOnly].sort());
		expect(hostedOnly.every((name) => name.startsWith("account_"))).toBe(true);
	});

	it("tool names are unique across groups", async () => {
		const { nonHosted, hostedOnly } = await registered(undefined);
		const all = [...nonHosted, ...hostedOnly];
		expect(new Set(all).size).toBe(all.length);
	});
});
