import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerSubgraphsCommand, webhookHint } from "./subgraphs.ts";

const ENV = [
	"INSTANCE_TOKEN",
	"SL_API_KEY",
	"SECONDLAYER_API_KEY",
	"SECONDLAYER_API_URL",
	"SL_API_URL",
	"SL_PLATFORM_API_URL",
] as const;

function program(): Command {
	const p = new Command();
	p.exitOverride();
	registerSubgraphsCommand(p);
	return p;
}

describe("subgraphs against the hosted API", () => {
	let saved: Record<string, string | undefined>;
	let realFetch: typeof fetch;
	let calls: { url: string; auth: string | null }[];

	beforeEach(() => {
		saved = {};
		for (const k of ENV) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
		realFetch = globalThis.fetch;
		calls = [];
		globalThis.fetch = (async (
			input: Parameters<typeof fetch>[0],
			init?: RequestInit,
		) => {
			const url = input instanceof Request ? input.url : String(input);
			calls.push({
				url,
				auth: new Headers(init?.headers).get("authorization"),
			});
			return Response.json({ data: [] });
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		for (const k of ENV) {
			if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = saved[k];
		}
	});

	test("SECONDLAYER_API_KEY passes the preAction and is sent as the bearer on the merchant host", async () => {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";
		process.env.SECONDLAYER_API_KEY = "sk-sl_hosted";

		await program().parseAsync(["node", "secondlayer", "subgraphs", "list"]);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.secondlayer.tools/api/subgraphs");
		expect(calls[0]?.auth).toBe("Bearer sk-sl_hosted");
	});

	test("the merchant host with no account key is still refused before any request", async () => {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";

		await expect(
			program().parseAsync(["node", "secondlayer", "subgraphs", "list"]),
		).rejects.toThrow(/this command runs on your instance/);
		expect(calls).toHaveLength(0);
	});
});

describe("webhookHint", () => {
	test("self-host gets the webhook command", () => {
		expect(webhookHint("http://127.0.0.1:3800", "dex", "swaps")).toBe(
			"secondlayer webhooks create dex-hook --subgraph dex --table swaps --url <your-endpoint>",
		);
	});

	test("the hosted API gets none: subgraph webhooks are self-host only", () => {
		expect(
			webhookHint("https://api.secondlayer.tools", "dex", "swaps"),
		).toBeNull();
	});

	test("a subgraph with no table has nothing to point a webhook at", () => {
		expect(webhookHint("http://127.0.0.1:3800", "dex", undefined)).toBeNull();
	});
});
