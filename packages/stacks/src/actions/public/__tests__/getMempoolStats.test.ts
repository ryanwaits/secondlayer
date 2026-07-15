import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { getMempoolStats } from "../getMempoolStats.ts";

function mockClient(handler: (path: string) => unknown): Client {
	return {
		request: async (path: string) => handler(path),
	} as unknown as Client;
}

describe("getMempoolStats", () => {
	it("requests the mempool stats endpoint", async () => {
		let seenPath = "";
		const client = mockClient((path) => {
			seenPath = path;
			return { tx_type_counts: {} };
		});
		await getMempoolStats(client);
		expect(seenPath).toBe("/extended/v1/tx/mempool/stats");
	});

	it("returns the response body", async () => {
		const resp = { tx_type_counts: { token_transfer: 3 } };
		const client = mockClient(() => resp);
		expect(await getMempoolStats(client)).toEqual(resp);
	});
});
