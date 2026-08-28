import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Subgraphs } from "../subgraphs/client.ts";

const BASE_URL = "http://localhost:3800";
const API_KEY = "test-key-123";

const originalFetch = globalThis.fetch;

function mockFetch(response: {
	ok: boolean;
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
}) {
	return mock(() =>
		Promise.resolve({
			ok: response.ok,
			status: response.status,
			headers: new Headers(response.headers),
			json: () => Promise.resolve(response.body),
			text: () =>
				Promise.resolve(
					typeof response.body === "string"
						? response.body
						: JSON.stringify(response.body ?? ""),
				),
		} as Response),
	) as unknown as typeof fetch;
}

describe("Subgraphs", () => {
	let subgraphs: Subgraphs;

	beforeEach(() => {
		subgraphs = new Subgraphs({
			baseUrl: BASE_URL,
			apiKey: API_KEY,
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("queryTable builds correct URL", async () => {
		globalThis.fetch = mockFetch({ ok: true, status: 200, body: [{ id: 1 }] });

		const result = await subgraphs.queryTable("my-subgraph", "events", {
			sort: "block_height",
			order: "desc",
			limit: 10,
		});
		expect(result).toEqual([{ id: 1 }]);

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toContain("/api/subgraphs/my-subgraph/events");
		expect(calledUrl).toContain("_sort=block_height");
		expect(calledUrl).toContain("_order=desc");
		expect(calledUrl).toContain("_limit=10");
	});

	test("queryTableCount builds correct URL", async () => {
		globalThis.fetch = mockFetch({
			ok: true,
			status: 200,
			body: { count: 42 },
		});

		const result = await subgraphs.queryTableCount("my-subgraph", "events", {
			filters: { sender: "SP123" },
		});
		expect(result).toEqual({ count: 42 });

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toContain("/api/subgraphs/my-subgraph/events/count");
		expect(calledUrl).toContain("sender=SP123");
	});

	test("queryTableAggregate builds correct URL", async () => {
		globalThis.fetch = mockFetch({
			ok: true,
			status: 200,
			body: { count: 4, sum: { amount: "6500000" } },
		});

		const result = await subgraphs.queryTableAggregate(
			"my-subgraph",
			"events",
			{ filters: { status: "active" }, count: true, sum: ["amount"] },
		);
		expect(result).toEqual({ count: 4, sum: { amount: "6500000" } });

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toContain("/api/subgraphs/my-subgraph/events/aggregate");
		expect(calledUrl).toContain("status=active");
		expect(calledUrl).toContain("_count=true");
		expect(calledUrl).toContain("_sum=amount");
	});

	test("queryTableAggregate comma-joins multi-column aggs", async () => {
		globalThis.fetch = mockFetch({ ok: true, status: 200, body: {} });

		await subgraphs.queryTableAggregate("my-subgraph", "events", {
			min: ["a", "b"],
			countDistinct: ["c"],
		});

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
		expect(calledUrl).toContain("_min=a,b");
		expect(calledUrl).toContain("_countDistinct=c");
	});

	test("queryTable with no params omits query string", async () => {
		globalThis.fetch = mockFetch({ ok: true, status: 200, body: [] });

		await subgraphs.queryTable("my-subgraph", "events");

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toBe(`${BASE_URL}/api/subgraphs/my-subgraph/events`);
	});

	test("deploy sends POST to /api/subgraphs with startBlock", async () => {
		const deployData = {
			name: "test-subgraph",
			sources: { events: { type: "print_event" } },
			schema: { events: { columns: { sender: { type: "principal" } } } },
			handlerCode: "export default {}",
			startBlock: 123,
		};
		globalThis.fetch = mockFetch({
			ok: true,
			status: 200,
			body: { name: "test-subgraph", status: "deploying" },
		});

		await subgraphs.deploy(deployData);

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const [calledUrl, calledOpts] = fetchMock.mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(calledUrl).toBe(`${BASE_URL}/api/subgraphs`);
		expect(calledOpts.method).toBe("POST");
		expect(JSON.parse(calledOpts.body as string).startBlock).toBe(123);
	});

	test("openapi builds spec URL with server override", async () => {
		globalThis.fetch = mockFetch({
			ok: true,
			status: 200,
			body: { openapi: "3.1.0" },
		});

		await subgraphs.openapi("my-subgraph", {
			serverUrl: "https://tenant.example.test",
		});

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toBe(
			`${BASE_URL}/api/subgraphs/my-subgraph/openapi.json?server=https%3A%2F%2Ftenant.example.test`,
		);
	});

	test("gaps builds URL with pagination + resolved flag", async () => {
		globalThis.fetch = mockFetch({ ok: true, status: 200, body: { gaps: [] } });

		await subgraphs.gaps("my-subgraph", {
			limit: 25,
			offset: 50,
			resolved: false,
		});

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toContain("/api/subgraphs/my-subgraph/gaps?");
		expect(calledUrl).toContain("_limit=25");
		expect(calledUrl).toContain("_offset=50");
		expect(calledUrl).toContain("resolved=false");
	});

	test("gaps with no opts omits query string", async () => {
		globalThis.fetch = mockFetch({ ok: true, status: 200, body: { gaps: [] } });

		await subgraphs.gaps("my-subgraph");

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toBe(`${BASE_URL}/api/subgraphs/my-subgraph/gaps`);
	});

	test("delete appends force only when set", async () => {
		globalThis.fetch = mockFetch({
			ok: true,
			status: 200,
			body: { message: "ok" },
		});

		await subgraphs.delete("my-subgraph");
		await subgraphs.delete("my-subgraph", { force: true });

		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		expect(fetchMock.mock.calls[0][0]).toBe(
			`${BASE_URL}/api/subgraphs/my-subgraph`,
		);
		expect(fetchMock.mock.calls[1][0]).toBe(
			`${BASE_URL}/api/subgraphs/my-subgraph?force=true`,
		);
	});

	// Publishing claimed a subgraph name in a hosted global namespace. A
	// self-hosted instance has no such namespace, so the verb was removed
	// rather than shimmed — it must not come back on the client.
	test("the public-namespace claim verbs are gone from the client", () => {
		const client = subgraphs as unknown as Record<string, unknown>;
		expect(client.publish).toBeUndefined();
		expect(client.unpublish).toBeUndefined();
	});

	test("status reads the same detail endpoint as get", async () => {
		globalThis.fetch = mockFetch({
			ok: true,
			status: 200,
			body: { name: "my-subgraph", status: "synced" },
		});

		const result = await subgraphs.status("my-subgraph");

		expect(result).toMatchObject({ name: "my-subgraph", status: "synced" });
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		expect(fetchMock.mock.calls[0][0]).toBe(
			`${BASE_URL}/api/subgraphs/my-subgraph`,
		);
	});

	test("markdown returns text response", async () => {
		globalThis.fetch = mockFetch({
			ok: true,
			status: 200,
			body: "# docs\n",
		});

		const result = await subgraphs.markdown("my-subgraph");

		expect(result).toBe("# docs\n");
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		expect(calledUrl).toBe(`${BASE_URL}/api/subgraphs/my-subgraph/docs.md`);
	});

	describe("path segments", () => {
		test("a name with path and query characters is percent-encoded so it cannot retarget the request", async () => {
			globalThis.fetch = mockFetch({ ok: true, status: 200, body: {} });
			const hostile = "a/../b?x#y";
			const encoded = encodeURIComponent(hostile);

			await subgraphs.status(hostile);
			await subgraphs.queryTable(hostile, hostile);
			await subgraphs.rows(hostile, hostile);
			await subgraphs.getOperation(hostile, hostile);

			const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
			const urls = fetchMock.mock.calls.map((c) => c[0] as string);
			expect(urls[0]).toBe(`${BASE_URL}/api/subgraphs/${encoded}`);
			expect(urls[1]).toBe(`${BASE_URL}/api/subgraphs/${encoded}/${encoded}`);
			expect(urls[2]).toBe(`${BASE_URL}/v1/subgraphs/${encoded}/${encoded}`);
			expect(urls[3]).toBe(
				`${BASE_URL}/api/subgraphs/${encoded}/operations/${encoded}`,
			);
			for (const url of urls) {
				expect(url).not.toContain("/..");
				expect(url).not.toContain("?");
				expect(url).not.toContain("#");
			}
		});
	});

	describe("typed() where aliases", () => {
		const def = {
			name: "tokens",
			schema: {
				listings: {
					columns: { id: { type: "uint" }, amount: { type: "uint" } },
				},
				transfers: { columns: { amount: { type: "uint" } } },
			},
		} as const;

		test("where id targets the user id column when the table declares one", async () => {
			globalThis.fetch = mockFetch({ ok: true, status: 200, body: [] });
			const typed = subgraphs.typed(def);
			await typed.listings.findMany({ where: { id: 7 } as never });
			const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
			const url = new URL(fetchMock.mock.calls[0][0] as string);
			expect(url.searchParams.get("id")).toBe("7");
			expect(url.searchParams.get("_id")).toBeNull();
		});

		test("where id targets the system _id column when the table declares none", async () => {
			globalThis.fetch = mockFetch({ ok: true, status: 200, body: [] });
			const typed = subgraphs.typed(def);
			await typed.transfers.findMany({ where: { id: 7 } as never });
			const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
			const url = new URL(fetchMock.mock.calls[0][0] as string);
			expect(url.searchParams.get("_id")).toBe("7");
			expect(url.searchParams.get("id")).toBeNull();
		});
	});

	describe("typed() subscribe", () => {
		/** A token-gated SSE mock: 401 without the bearer, otherwise streams
		 *  the frames for that connection (by request ordinal, last entry
		 *  repeats) and stays open until the request aborts, or closes cleanly
		 *  right after its frames when `closeAfterFrames` is set. */
		function gatedSse(
			frames: string[] | string[][],
			seen: Request[],
			closeAfterFrames = false,
		) {
			return (async (input: string | URL | Request, init?: RequestInit) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				seen.push(request);
				if (request.headers.get("Authorization") !== `Bearer ${API_KEY}`) {
					return new Response("unauthorized", { status: 401 });
				}
				const perConnection = Array.isArray(frames[0])
					? (frames as string[][])
					: [frames as string[]];
				const mine =
					perConnection[Math.min(seen.length - 1, perConnection.length - 1)];
				const signal = init?.signal;
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						const enc = new TextEncoder();
						for (const f of mine) controller.enqueue(enc.encode(f));
						const close = () => {
							try {
								controller.close();
							} catch {
								// already closed
							}
						};
						if (closeAfterFrames || signal?.aborted) close();
						else signal?.addEventListener("abort", close, { once: true });
					},
				});
				return new Response(stream, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}) as typeof fetch;
		}

		/** Rows arrive in the server's wire shape: raw column names, bigint
		 *  columns as strings. */
		const WIRE_ROW = { _id: 1, _block_height: "10", amount: "5" };

		test("sends the bearer token and origin so a token-gated instance streams rows instead of 401", async () => {
			const seen: Request[] = [];
			const client = new Subgraphs({
				baseUrl: BASE_URL,
				apiKey: API_KEY,
				origin: "mcp",
				fetchImpl: gatedSse(
					["event: ping\ndata: \n\n", `data: ${JSON.stringify(WIRE_ROW)}\n\n`],
					seen,
				),
			});
			const typed = client.typed({
				name: "my subgraph",
				schema: { transfers: { columns: { amount: { type: "uint" } } } },
			} as const);
			const rows: unknown[] = [];
			const errors: unknown[] = [];
			let unsubscribe = () => {};
			await new Promise<void>((resolve) => {
				unsubscribe = typed.transfers.subscribe(
					(row) => {
						rows.push(row);
						resolve();
					},
					{
						where: { amount: { gte: "1" } } as never,
						since: 5,
						onError: (e) => errors.push(e),
					},
				);
			});
			unsubscribe();

			expect(rows).toEqual([WIRE_ROW]);
			expect(errors).toEqual([]);
			expect(seen).toHaveLength(1);
			const url = new URL(seen[0].url);
			expect(url.pathname).toBe("/v1/subgraphs/my%20subgraph/transfers/stream");
			expect(url.searchParams.get("amount.gte")).toBe("1");
			expect(url.searchParams.get("since")).toBe("5");
			expect(seen[0].headers.get("Accept")).toBe("text/event-stream");
			expect(seen[0].headers.get("x-sl-origin")).toBe("mcp");
		});

		test("a dropped connection reconnects from the last delivered row's block height", async () => {
			const seen: Request[] = [];
			const client = new Subgraphs({
				baseUrl: BASE_URL,
				apiKey: API_KEY,
				fetchImpl: gatedSse(
					[
						// First connection: one wire-shaped row, then a clean close.
						[`data: ${JSON.stringify({ _id: 7, _block_height: "42" })}\n\n`],
						// Reconnect: another row, then close again.
						[`data: ${JSON.stringify({ _id: 8, _block_height: "43" })}\n\n`],
					],
					seen,
					true,
				),
			});
			const typed = client.typed({
				name: "s",
				schema: { t: { columns: {} } },
			} as const);
			const rows: unknown[] = [];
			let unsubscribe = () => {};
			await new Promise<void>((resolve) => {
				unsubscribe = typed.t.subscribe((row) => {
					rows.push(row);
					if (rows.length === 2) resolve();
				});
			});
			unsubscribe();

			expect(rows.map((r) => (r as { _id: number })._id)).toEqual([7, 8]);
			expect(seen.length).toBeGreaterThanOrEqual(2);
			expect(new URL(seen[0].url).searchParams.get("since")).toBeNull();
			expect(new URL(seen[1].url).searchParams.get("since")).toBe("42");
		});

		test("a 401 reaches onError and the stream keeps retrying until unsubscribed", async () => {
			const seen: Request[] = [];
			const client = new Subgraphs({
				baseUrl: BASE_URL,
				apiKey: "wrong-key",
				fetchImpl: gatedSse([], seen),
			});
			const typed = client.typed({
				name: "s",
				schema: { t: { columns: {} } },
			} as const);
			const errors: unknown[] = [];
			let unsubscribe = () => {};
			await new Promise<void>((resolve) => {
				unsubscribe = typed.t.subscribe(() => {}, {
					onError: (e) => {
						errors.push(e);
						resolve();
					},
				});
			});
			unsubscribe();
			expect(errors).toHaveLength(1);
			expect((errors[0] as { status?: number }).status).toBe(401);
		});
	});
});
