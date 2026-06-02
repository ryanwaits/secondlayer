import { describe, expect, it } from "bun:test";
import type { getClient } from "./lib/client.ts";
import { buildContext } from "./resources.ts";

type Client = ReturnType<typeof getClient>;

describe("secondlayer://context", () => {
	it("assembles live state when authenticated", async () => {
		const client = {
			subgraphs: {
				list: async () => ({
					data: [
						{
							name: "swaps",
							status: "running",
							tables: ["t"],
							lastProcessedBlock: 5,
						},
					],
				}),
			},
			subscriptions: {
				list: async () => ({
					data: [{ status: "active" }, { status: "paused" }],
				}),
			},
		} as unknown as Client;

		const ctx = await buildContext({
			clientProvider: () => client,
			accountRequest: async () => ({ email: "a@b.com", plan: "build" }),
		});

		expect(Array.isArray(ctx.whatExists.subgraphs)).toBe(true);
		expect(ctx.whatExists.subscriptions).toEqual({
			count: 2,
			statuses: ["active", "paused"],
		});
		expect(ctx.whatExists.account).toEqual({ email: "a@b.com", plan: "build" });
		expect(ctx.whatYouCanDo.products.length).toBeGreaterThan(0);
		expect(ctx.readAuthTiers.streams).toContain("SL_API_KEY");
	});

	it("degrades gracefully when keyless calls fail (never throws)", async () => {
		const client = {
			subgraphs: { list: async () => ({ data: [] }) }, // public read still works
			subscriptions: {
				list: async () => {
					throw new Error("401");
				},
			},
		} as unknown as Client;

		const ctx = await buildContext({
			clientProvider: () => client,
			accountRequest: async () => {
				throw new Error("401");
			},
		});

		expect(ctx.whatExists.subgraphs).toEqual([]);
		expect(ctx.whatExists.subscriptions).toBe("unavailable: set SL_API_KEY");
		expect(ctx.whatExists.account).toBe("unavailable: set SL_API_KEY");
	});
});
