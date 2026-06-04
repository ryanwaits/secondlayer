import { beforeAll, describe, expect, it } from "bun:test";
import type { getClient } from "./lib/client.ts";
import { getRegisteredToolNames } from "./lib/tool.ts";
import { buildCapabilities, buildContext } from "./resources.ts";
import { createServer } from "./server.ts";

type Client = ReturnType<typeof getClient>;

// Registering all tools populates the global tool registry that
// buildCapabilities reads (mirrors production: register*Tools run before any
// context read). Without this the registry is empty and capabilities are blank.
beforeAll(() => {
	createServer();
});

describe("secondlayer://context", () => {
	it("assembles live state from the SDK context snapshot", async () => {
		const client = {
			context: async () => ({
				account: { email: "a@b.com", plan: "build" },
				streamsTip: {
					block_height: 100,
					block_hash: "0xabc",
					burn_block_height: 50,
					lag_seconds: 2,
				},
				indexTip: { block_height: 99, lag_seconds: 3 },
				subgraphs: [
					{
						name: "swaps",
						status: "running",
						tables: ["t"],
						lastProcessedBlock: 5,
					},
				],
				subscriptions: { count: 2, byStatus: { active: 1, paused: 1 } },
				activeOperations: [],
			}),
		} as unknown as Client;

		const ctx = await buildContext({ clientProvider: () => client });

		expect(Array.isArray(ctx.whatExists.subgraphs)).toBe(true);
		expect(ctx.whatExists.subscriptions).toEqual({
			count: 2,
			byStatus: { active: 1, paused: 1 },
		});
		expect(ctx.whatExists.account).toEqual({ email: "a@b.com", plan: "build" });
		expect(ctx.whatExists.streamsTip).toEqual({
			block_height: 100,
			block_hash: "0xabc",
			burn_block_height: 50,
			lag_seconds: 2,
		});
		expect(ctx.whatExists.activeOperations).toEqual([]);
		expect(ctx.whatYouCanDo.products.length).toBeGreaterThan(0);
		expect(ctx.readAuthTiers.streams).toContain("SL_API_KEY");
	});

	it("degrades gracefully when a field is unavailable (never throws)", async () => {
		const client = {
			context: async () => ({
				account: null,
				streamsTip: null,
				indexTip: null,
				subgraphs: [],
				subscriptions: null,
				activeOperations: null,
			}),
		} as unknown as Client;

		const ctx = await buildContext({ clientProvider: () => client });

		expect(ctx.whatExists.subgraphs).toEqual([]);
		expect(ctx.whatExists.subscriptions).toBe("unavailable: set SL_API_KEY");
		expect(ctx.whatExists.account).toBe("unavailable: set SL_API_KEY");
		expect(ctx.whatExists.streamsTip).toBe("unavailable: set SL_API_KEY");
	});
});

describe("capabilities ↔ tool registry", () => {
	// Guards against CAPABILITIES drifting behind the tool surface: every tool
	// registered via defineTool must appear in the generated capability list. If
	// this fails, a tool was added but buildCapabilities couldn't place it (e.g.
	// an unknown product prefix) — fix the generator, don't hand-edit a list.
	it("lists every registered tool", () => {
		const names = getRegisteredToolNames();
		expect(names.length).toBeGreaterThan(0);
		const listed = buildCapabilities().products.join(" ");
		const missing = names.filter((n) => !listed.includes(n));
		expect(missing).toEqual([]);
	});
});
