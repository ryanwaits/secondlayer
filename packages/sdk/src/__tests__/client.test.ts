import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SecondLayer } from "../client.ts";
import { StreamsSignatureError, createStreamsClient } from "../index.ts";

describe("SecondLayer root client", () => {
	test("exposes Streams, Index, and Subgraphs clients", async () => {
		const requests: Request[] = [];
		const sl = new SecondLayer({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				requests.push(request);
				return new Response(
					JSON.stringify({
						block_height: 100,
						block_hash: "0x01",
						burn_block_height: 200,
						burn_block_hash: null,
						is_canonical: true,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});

		expect(sl.streams).toBeDefined();
		expect(sl.index.ftTransfers).toBeDefined();
		expect(sl.index.nftTransfers).toBeDefined();
		expect(sl.subgraphs).toBeDefined();

		await sl.streams.canonical(100);
		expect(new URL(requests[0]?.url ?? "").pathname).toBe(
			"/v1/streams/canonical/100",
		);
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
	});

	test("keyless Streams calls omit Authorization instead of sending Bearer empty", async () => {
		const requests: Request[] = [];
		const sl = new SecondLayer({
			apiKey: "",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				requests.push(request);
				return new Response(
					JSON.stringify({
						block_height: 100,
						block_hash: "0x01",
						burn_block_height: 200,
						burn_block_hash: null,
						is_canonical: true,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});

		await sl.streams.canonical(100);
		expect(requests[0]?.headers.get("Authorization")).toBeNull();
	});
});

describe("credential precedence is the same at every entry point", () => {
	const originalToken = process.env.INSTANCE_TOKEN;
	const originalLegacy = process.env.SL_API_KEY;

	beforeEach(() => {
		delete process.env.SL_API_KEY;
		process.env.INSTANCE_TOKEN = "sk-sl_from_env";
	});

	afterEach(() => {
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
	});

	test("createStreamsClient() with no apiKey sends INSTANCE_TOKEN as the bearer", async () => {
		const requests: Request[] = [];
		const streams = createStreamsClient({
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				requests.push(
					input instanceof Request
						? input
						: new Request(input.toString(), init),
				);
				return new Response(
					JSON.stringify({
						block_height: 1,
						block_hash: "0x01",
						burn_block_height: 2,
						lag_seconds: 0,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});
		await streams.tip();
		expect(requests[0]?.headers.get("Authorization")).toBe(
			"Bearer sk-sl_from_env",
		);
	});

	test("an explicit empty apiKey keeps createStreamsClient keyless", async () => {
		const requests: Request[] = [];
		const streams = createStreamsClient({
			apiKey: "",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				requests.push(
					input instanceof Request
						? input
						: new Request(input.toString(), init),
				);
				return new Response(
					JSON.stringify({
						block_height: 1,
						block_hash: "0x01",
						burn_block_height: 2,
						lag_seconds: 0,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});
		await streams.tip();
		expect(requests[0]?.headers.get("Authorization")).toBeNull();
	});

	test("SecondLayer forwards origin to sl.streams so every sub-client labels itself the same", async () => {
		const requests: Request[] = [];
		const sl = new SecondLayer({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			origin: "mcp",
			fetchImpl: async (input, init) => {
				requests.push(
					input instanceof Request
						? input
						: new Request(input.toString(), init),
				);
				return new Response(
					JSON.stringify({
						block_height: 1,
						block_hash: "0x01",
						burn_block_height: 2,
						lag_seconds: 0,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});
		await sl.streams.tip();
		expect(requests[0]?.headers.get("x-sl-origin")).toBe("mcp");
	});

	test("createStreamsClient() defaults x-sl-origin to cli", async () => {
		const requests: Request[] = [];
		const streams = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				requests.push(
					input instanceof Request
						? input
						: new Request(input.toString(), init),
				);
				return new Response(
					JSON.stringify({
						block_height: 1,
						block_hash: "0x01",
						burn_block_height: 2,
						lag_seconds: 0,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});
		await streams.tip();
		expect(requests[0]?.headers.get("x-sl-origin")).toBe("cli");
	});

	test("new SecondLayer() resolves the credential once, so a conflicting SL_API_KEY warns once", () => {
		process.env.INSTANCE_TOKEN = "sk-sl_a";
		process.env.SL_API_KEY = "sk-sl_b";
		const original = console.warn;
		const warnings: unknown[] = [];
		console.warn = (...args: unknown[]) => {
			warnings.push(args);
		};
		try {
			new SecondLayer({ baseUrl: "http://secondlayer.test" });
		} finally {
			console.warn = original;
		}
		expect(warnings.length).toBeLessThanOrEqual(1);
	});
});

describe("SecondLayer forwards verification options to Streams", () => {
	test("verify: true makes sl.streams reject an unsigned response", async () => {
		const sl = new SecondLayer({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			verify: true,
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						block_height: 1,
						block_hash: "0x01",
						burn_block_height: 2,
						lag_seconds: 0,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		});
		await expect(sl.streams.tip()).rejects.toBeInstanceOf(
			StreamsSignatureError,
		);
	});

	test("without verify an unsigned response still passes (lenient default)", async () => {
		const sl = new SecondLayer({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						block_height: 1,
						block_hash: "0x01",
						burn_block_height: 2,
						lag_seconds: 0,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		});
		const tip = await sl.streams.tip();
		expect(tip.block_height).toBe(1);
	});
});
