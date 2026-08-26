import { describe, expect, test } from "bun:test";
import {
	type ListObserverMessagesOpts,
	type SbaObserverMessage,
	messageFromRow,
} from "./observer-export.ts";
import {
	OBSERVER_HTTP_EXPORT_PATH,
	handleObserverEvents,
	resolveObserverHttpBindHost,
	shouldRegisterObserverHttpExport,
} from "./observer-http.ts";
import { bodyFromText, sha256Hex } from "./observer-journal.ts";

async function loadFixtureMessage(
	name: string,
	sequence: string,
): Promise<SbaObserverMessage> {
	const url = new URL(`../test/fixtures/observer/${name}`, import.meta.url);
	const bodyText = await Bun.file(url).text();
	const raw_body = bodyFromText(bodyText);
	const payload = JSON.parse(bodyText) as {
		block_height: number;
		index_block_hash: string;
	};
	return messageFromRow({
		sequence,
		path: "/new_block",
		raw_body,
		raw_body_sha256: sha256Hex(raw_body),
		block_height: payload.block_height,
		block_hash: null,
		received_at: "2026-01-01T00:00:00.000Z",
		status: "processed",
	});
}

function req(path: string, headers?: Record<string, string>): Request {
	return new Request(`http://127.0.0.1:3700${path}`, { headers });
}

describe("shouldRegisterObserverHttpExport", () => {
	test("default off even with token and loopback", () => {
		expect(
			shouldRegisterObserverHttpExport({
				exportFlag: undefined,
				token: "secret",
				bindHost: "127.0.0.1",
			}),
		).toBe(false);
	});

	test("export=1 + loopback + no token → true", () => {
		expect(
			shouldRegisterObserverHttpExport({
				exportFlag: "1",
				token: undefined,
				bindHost: "127.0.0.1",
			}),
		).toBe(true);
	});

	test("export=1 + 0.0.0.0 + no token → false", () => {
		expect(
			shouldRegisterObserverHttpExport({
				exportFlag: "1",
				token: undefined,
				bindHost: "0.0.0.0",
			}),
		).toBe(false);
	});

	test("export=1 + 0.0.0.0 + token → true", () => {
		expect(
			shouldRegisterObserverHttpExport({
				exportFlag: "1",
				token: "secret",
				bindHost: "0.0.0.0",
			}),
		).toBe(true);
	});
});

describe("resolveObserverHttpBindHost", () => {
	test("defaults to 0.0.0.0 when unset", () => {
		expect(resolveObserverHttpBindHost({})).toBe("0.0.0.0");
	});

	test("INDEXER_HOST wins over HOST", () => {
		expect(
			resolveObserverHttpBindHost({
				INDEXER_HOST: "127.0.0.1",
				HOST: "0.0.0.0",
			}),
		).toBe("127.0.0.1");
	});
});

describe("OBSERVER_HTTP_EXPORT_PATH", () => {
	test("is /internal/observer-events and not under /v1", () => {
		expect(OBSERVER_HTTP_EXPORT_PATH).toBe("/internal/observer-events");
		expect(OBSERVER_HTTP_EXPORT_PATH.startsWith("/v1")).toBe(false);
	});
});

describe("handleObserverEvents", () => {
	test("empty after tip → events [] next null", async () => {
		const calls: ListObserverMessagesOpts[] = [];
		const res = await handleObserverEvents(
			req("/internal/observer-events?after_height=999"),
			{
				list: async (opts) => {
					calls.push(opts);
					return [];
				},
				network: "mainnet",
				token: null,
			},
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("application/json");
		const body = (await res.json()) as {
			events: unknown[];
			next: unknown;
		};
		expect(body.events).toEqual([]);
		expect(body.next).toBeNull();
		expect(calls[0]?.afterHeight).toBe(999);
	});

	test("limit=1 pages with fixture payload time keys", async () => {
		const first = await loadFixtureMessage("new_block.timestamp.json", "1");
		const second = await loadFixtureMessage(
			"new_block.burn_block_time.json",
			"2",
		);
		const pages: SbaObserverMessage[][] = [[first], [second]];
		const listCalls: ListObserverMessagesOpts[] = [];

		const page1 = await handleObserverEvents(
			req("/internal/observer-events?limit=1"),
			{
				list: async (opts) => {
					listCalls.push(opts);
					return pages.shift() ?? [];
				},
				network: "mainnet",
				token: null,
			},
		);
		expect(page1.status).toBe(200);
		const body1 = (await page1.json()) as {
			events: SbaObserverMessage[];
			next: { after_height: number; after_index_block_hash: string } | null;
		};
		expect(body1.events).toHaveLength(1);
		expect(body1.events[0]?.block_height).toBe(100);
		expect(body1.events[0]?.index_block_hash).toBe("0xbbb222");
		expect(
			(body1.events[0]?.payload as Record<string, unknown>).timestamp,
		).toBe(1700000000);
		expect(body1.next).toEqual({
			after_height: 100,
			after_index_block_hash: "0xbbb222",
		});

		const next = body1.next;
		expect(next).not.toBeNull();
		const page2 = await handleObserverEvents(
			req(
				`/internal/observer-events?limit=1&after_height=${next?.after_height}&after_index_block_hash=${next?.after_index_block_hash}`,
			),
			{
				list: async (opts) => {
					listCalls.push(opts);
					return pages.shift() ?? [];
				},
				network: "mainnet",
				token: null,
			},
		);
		const body2 = (await page2.json()) as {
			events: SbaObserverMessage[];
			next: unknown;
		};
		expect(body2.events).toHaveLength(1);
		expect(body2.events[0]?.block_height).toBe(101);
		expect(
			(body2.events[0]?.payload as Record<string, unknown>).burn_block_time,
		).toBe(1700000001);

		expect(listCalls[1]?.afterHeight).toBe(100);
		expect(listCalls[1]?.afterIndexBlockHash).toBe("0xbbb222");
	});

	test("token set without Bearer → 401", async () => {
		const res = await handleObserverEvents(req("/internal/observer-events"), {
			list: async () => [],
			network: "mainnet",
			token: "secret",
		});
		expect(res.status).toBe(401);
	});

	test("token set with wrong Bearer → 401", async () => {
		const res = await handleObserverEvents(
			req("/internal/observer-events", {
				Authorization: "Bearer wrong",
			}),
			{
				list: async () => [],
				network: "mainnet",
				token: "secret",
			},
		);
		expect(res.status).toBe(401);
	});

	test("token set with matching Bearer → 200", async () => {
		const res = await handleObserverEvents(
			req("/internal/observer-events", {
				Authorization: "Bearer secret",
			}),
			{
				list: async () => [],
				network: "mainnet",
				token: "secret",
			},
		);
		expect(res.status).toBe(200);
	});

	test("invalid after_height → 400", async () => {
		const res = await handleObserverEvents(
			req("/internal/observer-events?after_height=not-a-number"),
			{
				list: async () => [],
				network: "mainnet",
				token: null,
			},
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("invalid after_height");
	});
});
