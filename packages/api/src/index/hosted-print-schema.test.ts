import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PrintSchemaCache, fetchHostedPrintSchema } from "./print-schema.ts";

const CONTRACT_ID = "SP000000000000000000002Q6VF78.sbtc-registry";
const TIP = { block_height: 10, finalized_height: 4, lag_seconds: 1 };

const savedEnv = { ...process.env };
beforeEach(() => {
	process.env.SUBGRAPH_INDEX_API_URL = "https://hosted.example/";
	process.env.INDEX_INTERNAL_API_KEY = "sk-sl_metered";
});
afterEach(() => {
	process.env = { ...savedEnv };
});

function fakeFetch(
	respond: (url: string, init: RequestInit | undefined) => Response,
) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const impl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		return respond(url, init);
	}) as unknown as typeof fetch;
	return { impl, calls };
}

describe("fetchHostedPrintSchema", () => {
	test("reads the hosted route with the key and drops the tip", async () => {
		const body = {
			contract_id: CONTRACT_ID,
			topics: [{ topic: "x", fields: [] }],
			sampled: false,
			total_events: 3,
			total_events_capped: false,
			sample: { size: 3, newest_height: 9, oldest_height: 1 },
			tip: TIP,
		};
		const { impl, calls } = fakeFetch(() => Response.json(body));
		const result = await fetchHostedPrintSchema(CONTRACT_ID, {
			fetchImpl: impl,
			cache: new PrintSchemaCache(),
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(
			`https://hosted.example/v1/index/contracts/${CONTRACT_ID}/print-schema`,
		);
		expect(
			(calls[0]?.init?.headers as Record<string, string>).authorization,
		).toBe("Bearer sk-sl_metered");
		expect(result.topics).toEqual(body.topics as never);
		expect("tip" in result).toBe(false);
	});

	test("memoizes per contract", async () => {
		const { impl, calls } = fakeFetch(() =>
			Response.json({
				contract_id: CONTRACT_ID,
				topics: [],
				sampled: false,
				total_events: 0,
				total_events_capped: false,
				sample: { size: 0, newest_height: null, oldest_height: null },
				tip: TIP,
			}),
		);
		const cache = new PrintSchemaCache();
		await fetchHostedPrintSchema(CONTRACT_ID, { fetchImpl: impl, cache });
		await fetchHostedPrintSchema(CONTRACT_ID, { fetchImpl: impl, cache });
		expect(calls).toHaveLength(1);
	});

	test("404 is an empty schema", async () => {
		const { impl } = fakeFetch(() => new Response("nope", { status: 404 }));
		const result = await fetchHostedPrintSchema(CONTRACT_ID, {
			fetchImpl: impl,
			cache: new PrintSchemaCache(),
		});
		expect(result.topics).toEqual([]);
		expect(result.total_events).toBe(0);
	});

	test("other failures throw so the caller skips the check", async () => {
		const { impl } = fakeFetch(() => new Response("bad", { status: 502 }));
		await expect(
			fetchHostedPrintSchema(CONTRACT_ID, {
				fetchImpl: impl,
				cache: new PrintSchemaCache(),
			}),
		).rejects.toThrow("502");
	});
});
