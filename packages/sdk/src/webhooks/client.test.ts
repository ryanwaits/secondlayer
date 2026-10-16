import { describe, expect, it } from "bun:test";
import { Webhooks } from "./client.ts";

function recordingClient() {
	const urls: string[] = [];
	const client = new Webhooks({
		apiKey: "sl_test",
		baseUrl: "https://api.example.test",
		fetchImpl: async (input) => {
			urls.push(String(input));
			return new Response(JSON.stringify({ total: 0, data: [], hours: [] }), {
				headers: { "content-type": "application/json" },
			});
		},
	});
	return { client, urls };
}

describe("Webhooks deliveries and activity queries", () => {
	it("sends from and to only when a window is given", async () => {
		const { client, urls } = recordingClient();
		await client.deliveries("wh_1");
		await client.deliveries("wh_1", {
			from: "2026-10-15T10:00:00.000Z",
			to: "2026-10-15T11:00:00.000Z",
		});
		expect(urls[0]).toBe(
			"https://api.example.test/api/webhooks/wh_1/deliveries",
		);
		expect(urls[1]).toBe(
			"https://api.example.test/api/webhooks/wh_1/deliveries?from=2026-10-15T10%3A00%3A00.000Z&to=2026-10-15T11%3A00%3A00.000Z",
		);
	});

	it("sends days=30 only when asked", async () => {
		const { client, urls } = recordingClient();
		await client.activity("wh_1");
		await client.activity("wh_1", { days: 30 });
		expect(urls[0]).toBe("https://api.example.test/api/webhooks/wh_1/activity");
		expect(urls[1]).toBe(
			"https://api.example.test/api/webhooks/wh_1/activity?days=30",
		);
	});
});
