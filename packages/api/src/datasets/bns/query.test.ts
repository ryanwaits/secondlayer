import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	getBnsNamesResponse,
	getBnsNamespacesResponse,
	getBnsResolveResponse,
	parseBnsMarketplaceEventsQuery,
	parseBnsNameEventsQuery,
	parseBnsNamespaceEventsQuery,
} from "./query.ts";

const TIP = { block_height: 7_900_000 };

describe("parseBnsNameEventsQuery", () => {
	test("defaults to one-day window", () => {
		const parsed = parseBnsNameEventsQuery(new URLSearchParams(), TIP);
		expect(parsed.fromBlock).toBe(7_900_000 - 17_280);
		expect(parsed.toBlock).toBe(7_900_000);
		expect(parsed.limit).toBe(200);
	});

	test("parses topic + namespace + name + owner", () => {
		const parsed = parseBnsNameEventsQuery(
			new URLSearchParams({
				topic: "transfer-name",
				namespace: "btc",
				name: "alice",
				owner: "SP1",
			}),
			TIP,
		);
		expect(parsed.topic).toBe("transfer-name");
		expect(parsed.namespace).toBe("btc");
		expect(parsed.name).toBe("alice");
		expect(parsed.owner).toBe("SP1");
	});

	test("rejects invalid topic", () => {
		expect(() =>
			parseBnsNameEventsQuery(new URLSearchParams({ topic: "bogus" }), TIP),
		).toThrow(ValidationError);
	});
});

describe("parseBnsNamespaceEventsQuery", () => {
	test("parses status + namespace", () => {
		const parsed = parseBnsNamespaceEventsQuery(
			new URLSearchParams({ status: "launch", namespace: "btc" }),
			TIP,
		);
		expect(parsed.status).toBe("launch");
		expect(parsed.namespace).toBe("btc");
	});

	test("rejects invalid status", () => {
		expect(() =>
			parseBnsNamespaceEventsQuery(
				new URLSearchParams({ status: "bogus" }),
				TIP,
			),
		).toThrow(ValidationError);
	});
});

describe("parseBnsMarketplaceEventsQuery", () => {
	test("parses action + bns_id", () => {
		const parsed = parseBnsMarketplaceEventsQuery(
			new URLSearchParams({ action: "list-in-ustx", bns_id: "12345" }),
			TIP,
		);
		expect(parsed.action).toBe("list-in-ustx");
		expect(parsed.bnsId).toBe("12345");
	});

	test("rejects invalid action", () => {
		expect(() =>
			parseBnsMarketplaceEventsQuery(
				new URLSearchParams({ action: "bogus" }),
				TIP,
			),
		).toThrow(ValidationError);
	});
});

describe("getBnsResolveResponse", () => {
	test("requires fqn param", async () => {
		await expect(
			getBnsResolveResponse({ query: new URLSearchParams() }),
		).rejects.toThrow(ValidationError);
	});

	test("rejects fqn without dot", async () => {
		await expect(
			getBnsResolveResponse({ query: new URLSearchParams({ fqn: "alice" }) }),
		).rejects.toThrow(ValidationError);
	});

	test("rejects fqn with invalid chars", async () => {
		await expect(
			getBnsResolveResponse({
				query: new URLSearchParams({ fqn: "alice.btc!" }),
			}),
		).rejects.toThrow(ValidationError);
	});

	test("returns found when name exists", async () => {
		const row = {
			fqn: "alice.btc",
			namespace: "btc",
			name: "alice",
			owner: "SP1",
			bns_id: "1",
			registered_at: 100,
			renewal_height: 1000,
			last_event_cursor: "100:0",
			last_event_at: "2026-05-12T00:00:00.000Z",
		};
		const result = await getBnsResolveResponse({
			query: new URLSearchParams({ fqn: "alice.btc" }),
			resolveName: async () => row,
			readEarliestIndexedBlock: async () => 7_800_000,
		});
		expect(result).toEqual({ status: "found", name: row });
	});

	test("returns not_indexed when no match and earliest indexed block is past gap threshold", async () => {
		const result = await getBnsResolveResponse({
			query: new URLSearchParams({ fqn: "muneeb.btc" }),
			resolveName: async () => null,
			readEarliestIndexedBlock: async () => 7_800_000,
		});
		expect(result).toEqual({
			status: "not_indexed",
			earliest_indexed_block: 7_800_000,
		});
	});

	test("returns not_found when no match and projection covers from early blocks", async () => {
		const result = await getBnsResolveResponse({
			query: new URLSearchParams({ fqn: "ghost.btc" }),
			resolveName: async () => null,
			readEarliestIndexedBlock: async () => 100,
		});
		expect(result).toEqual({ status: "not_found" });
	});

	test("returns not_found when projection is empty (earliest = null)", async () => {
		const result = await getBnsResolveResponse({
			query: new URLSearchParams({ fqn: "ghost.btc" }),
			resolveName: async () => null,
			readEarliestIndexedBlock: async () => null,
		});
		expect(result).toEqual({ status: "not_found" });
	});
});

describe("getBnsNamesResponse", () => {
	const ROW = {
		fqn: "alice.btc",
		namespace: "btc",
		name: "alice",
		owner: "SP1",
		bns_id: "42",
		registered_at: 100,
		renewal_height: 1000,
		last_event_cursor: "100:0",
		last_event_at: "2026-05-12T00:00:00.000Z",
	};

	test("rejects offset param with helpful message", async () => {
		await expect(
			getBnsNamesResponse({
				query: new URLSearchParams({ offset: "10" }),
				readNames: async () => ({ names: [], next_cursor: null }),
			}),
		).rejects.toThrow(ValidationError);
	});

	test("rejects non-numeric cursor", async () => {
		await expect(
			getBnsNamesResponse({
				query: new URLSearchParams({ cursor: "not-a-number" }),
				readNames: async () => ({ names: [], next_cursor: null }),
			}),
		).rejects.toThrow(ValidationError);
	});

	test("passes parsed cursor to reader as afterBnsId", async () => {
		let captured: { afterBnsId?: string } = {};
		await getBnsNamesResponse({
			query: new URLSearchParams({ cursor: "42" }),
			readNames: async (params) => {
				captured = params;
				return { names: [], next_cursor: null };
			},
		});
		expect(captured.afterBnsId).toBe("42");
	});

	test("returns next_cursor when reader signals more rows", async () => {
		const result = await getBnsNamesResponse({
			query: new URLSearchParams({ limit: "1" }),
			readNames: async () => ({ names: [ROW], next_cursor: "42" }),
		});
		expect(result).toEqual({ names: [ROW], next_cursor: "42" });
	});
});

describe("getBnsNamespacesResponse", () => {
	const NS_ROW = {
		namespace: "btc",
		manager: null,
		manager_frozen: false,
		price_frozen: false,
		lifetime: null,
		launched_at: null,
		last_event_cursor: "100:0",
		last_event_at: "2026-05-12T00:00:00.000Z",
		name_count: 1234,
	};

	test("returns rows when projection is populated", async () => {
		const result = await getBnsNamespacesResponse({
			readNamespaces: async () => ({ namespaces: [NS_ROW] }),
			readEarliestIndexedBlock: async () => 7_800_000,
		});
		expect(result).toEqual({ namespaces: [NS_ROW] });
	});

	test("flags backfill_pending when empty + earliest past threshold", async () => {
		const result = await getBnsNamespacesResponse({
			readNamespaces: async () => ({ namespaces: [] }),
			readEarliestIndexedBlock: async () => 7_800_000,
		});
		expect(result).toEqual({
			namespaces: [],
			status: "backfill_pending",
			earliest_indexed_block: 7_800_000,
		});
	});

	test("returns plain empty when projection covers from early blocks", async () => {
		const result = await getBnsNamespacesResponse({
			readNamespaces: async () => ({ namespaces: [] }),
			readEarliestIndexedBlock: async () => 100,
		});
		expect(result).toEqual({ namespaces: [] });
	});

	test("returns plain empty when projection has no data at all", async () => {
		const result = await getBnsNamespacesResponse({
			readNamespaces: async () => ({ namespaces: [] }),
			readEarliestIndexedBlock: async () => null,
		});
		expect(result).toEqual({ namespaces: [] });
	});
});
