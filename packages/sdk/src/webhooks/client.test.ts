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

	it("sends tx, height and cursor filters under the route's query names", async () => {
		const { client, urls } = recordingClient();
		await client.deliveries("wh_1", {
			txId: "0xabc",
			fromHeight: 100,
			toHeight: 200,
			cursor: "c1",
			limit: 50,
		});
		expect(urls[0]).toBe(
			"https://api.example.test/api/webhooks/wh_1/deliveries?tx_id=0xabc&from_height=100&to_height=200&cursor=c1&_limit=50",
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

describe("Webhooks list paging", () => {
	function pagedClient(total: number) {
		const urls: string[] = [];
		const client = new Webhooks({
			apiKey: "sl_test",
			baseUrl: "https://api.example.test",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				urls.push(url.search);
				const limit = Number(url.searchParams.get("_limit") ?? 50);
				const offset = Number(url.searchParams.get("_offset") ?? 0);
				const count = Math.max(0, Math.min(limit, total - offset));
				const data = Array.from({ length: count }, (_, i) => ({
					id: `wh_${offset + i}`,
				}));
				return new Response(JSON.stringify({ data }), {
					headers: { "content-type": "application/json" },
				});
			},
		});
		return { client, urls };
	}

	it("list sends no paging params unless asked", async () => {
		const { client, urls } = pagedClient(3);
		await client.list();
		await client.list({ limit: 10, offset: 20 });
		expect(urls).toEqual(["", "?_limit=10&_offset=20"]);
	});

	it("listAll reads past the first page until a short page", async () => {
		const { client, urls } = pagedClient(450);
		const all = await client.listAll();
		expect(all).toHaveLength(450);
		expect(new Set(all.map((w) => w.id)).size).toBe(450);
		expect(urls).toEqual([
			"?_limit=200&_offset=0",
			"?_limit=200&_offset=200",
			"?_limit=200&_offset=400",
		]);
	});

	it("listAll stops after an exactly full last page with one empty read", async () => {
		const { client, urls } = pagedClient(200);
		expect(await client.listAll()).toHaveLength(200);
		expect(urls).toHaveLength(2);
	});
});
