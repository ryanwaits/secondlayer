import { describe, expect, test } from "bun:test";
import {
	ReadCounter,
	classifyBillableRead,
	createSseBatchCounter,
} from "./read-meter.ts";

describe("classifyBillableRead", () => {
	test("a table list read counts as a read", () => {
		expect(classifyBillableRead("GET", "/v1/subgraphs/swaps/trades")).toBe(
			"read",
		);
	});

	test("a trailing slash does not change the answer", () => {
		expect(classifyBillableRead("GET", "/v1/subgraphs/swaps/trades/")).toBe(
			"read",
		);
	});

	test("a single row read counts as a read", () => {
		expect(classifyBillableRead("GET", "/v1/subgraphs/swaps/trades/42")).toBe(
			"read",
		);
	});

	test("a table count counts as a read", () => {
		expect(
			classifyBillableRead("GET", "/v1/subgraphs/swaps/trades/count"),
		).toBe("read");
	});

	test("a table aggregate counts as a read", () => {
		expect(
			classifyBillableRead("GET", "/v1/subgraphs/swaps/trades/aggregate"),
		).toBe("read");
	});

	test("a table stream is counted per batch, not per open", () => {
		expect(
			classifyBillableRead("GET", "/v1/subgraphs/swaps/trades/stream"),
		).toBe("stream");
	});

	test("recent rows count as a read", () => {
		expect(classifyBillableRead("GET", "/api/subgraphs/swaps/recent")).toBe(
			"read",
		);
	});

	test("the subgraph list is free", () => {
		expect(classifyBillableRead("GET", "/v1/subgraphs")).toBeNull();
	});

	test("a subgraph's own detail is free", () => {
		expect(classifyBillableRead("GET", "/v1/subgraphs/swaps")).toBeNull();
	});

	test("openapi.json is free", () => {
		expect(
			classifyBillableRead("GET", "/v1/subgraphs/swaps/openapi.json"),
		).toBeNull();
	});

	test("schema.json is free", () => {
		expect(
			classifyBillableRead("GET", "/v1/subgraphs/swaps/schema.json"),
		).toBeNull();
	});

	test("docs.md is free", () => {
		expect(
			classifyBillableRead("GET", "/v1/subgraphs/swaps/docs.md"),
		).toBeNull();
	});

	test("a table whose name merely starts like a metadata file still counts", () => {
		expect(
			classifyBillableRead("GET", "/v1/subgraphs/swaps/openapi.json.bak"),
		).toBe("read");
	});

	test("a non-GET request is free", () => {
		expect(
			classifyBillableRead("POST", "/v1/subgraphs/swaps/trades"),
		).toBeNull();
	});

	test("subgraph health and other /api/subgraphs paths are free", () => {
		expect(
			classifyBillableRead("GET", "/api/subgraphs/swaps/health"),
		).toBeNull();
		expect(classifyBillableRead("GET", "/api/subgraphs")).toBeNull();
		expect(classifyBillableRead("GET", "/api/subgraphs/swaps")).toBeNull();
	});

	test("webhooks, insights and the testnet are free", () => {
		expect(classifyBillableRead("GET", "/api/webhooks")).toBeNull();
		expect(classifyBillableRead("GET", "/api/insights/list")).toBeNull();
		expect(
			classifyBillableRead("GET", "/testnet/v1/subgraphs/swaps/trades"),
		).toBeNull();
	});
});

const enc = new TextEncoder();
const rowFrame = (id: number) => `id: ${id}\ndata: {"_id":${id}}\n\n`;
const PING = "event: ping\ndata: \n\n";

function counterWithClock() {
	let t = 0;
	const counter = createSseBatchCounter({ now: () => t });
	return {
		advance(ms: number) {
			t += ms;
		},
		push(text: string) {
			return counter.push(enc.encode(text));
		},
	};
}

describe("createSseBatchCounter", () => {
	test("three batches 1.5 s apart count three", () => {
		const c = counterWithClock();
		let total = 0;
		for (let batch = 0; batch < 3; batch++) {
			total += c.push(rowFrame(batch * 2) + rowFrame(batch * 2 + 1));
			c.advance(1500);
		}
		expect(total).toBe(3);
	});

	test("1,200 rows sent back to back count three", () => {
		const c = counterWithClock();
		let total = 0;
		for (let i = 0; i < 1200; i++) total += c.push(rowFrame(i));
		expect(total).toBe(3);
	});

	test("heartbeats never count", () => {
		const c = counterWithClock();
		let total = 0;
		for (let i = 0; i < 5; i++) {
			total += c.push(PING);
			c.advance(20_000);
		}
		expect(total).toBe(0);
	});

	test("a heartbeat between two batches does not split or add one", () => {
		const c = counterWithClock();
		let total = c.push(rowFrame(1));
		c.advance(20_000);
		total += c.push(PING);
		c.advance(1500);
		total += c.push(rowFrame(2));
		expect(total).toBe(2);
	});

	test("a frame split across two chunks counts once", () => {
		const c = counterWithClock();
		const frame = rowFrame(1);
		const cut = 8;
		const first = c.push(frame.slice(0, cut));
		const second = c.push(frame.slice(cut));
		expect(first + second).toBe(1);
	});

	test("CRLF framing counts the same as LF", () => {
		const c = counterWithClock();
		expect(c.push('id: 1\r\ndata: {"_id":1}\r\n\r\n')).toBe(1);
	});

	test("rows paced 1 s apart count one batch each", () => {
		const c = counterWithClock();
		let total = 0;
		for (let i = 0; i < 4; i++) {
			total += c.push(rowFrame(i));
			c.advance(1000);
		}
		expect(total).toBe(4);
	});
});

describe("ReadCounter", () => {
	test("ReadCounter drains per account and key, then reads zero", () => {
		const counter = new ReadCounter();
		counter.add("acct_1", "key_a", 2);
		counter.add("acct_1", "key_a", 1);
		counter.add("acct_1", "key_b", 5);
		counter.add("acct_2", "key_c", 1);
		counter.add("acct_2", "key_c", 0);
		counter.add("acct_2", "key_c", -3);
		counter.add("acct_2", "key_c", Number.NaN);
		const drained = counter
			.drain()
			.sort((a, b) => a.apiKeyId.localeCompare(b.apiKeyId));
		expect(drained).toEqual([
			{ accountId: "acct_1", apiKeyId: "key_a", count: 3 },
			{ accountId: "acct_1", apiKeyId: "key_b", count: 5 },
			{ accountId: "acct_2", apiKeyId: "key_c", count: 1 },
		]);
		expect(counter.drain()).toEqual([]);
	});
});
