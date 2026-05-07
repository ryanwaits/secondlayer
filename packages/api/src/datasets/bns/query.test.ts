import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
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
});
