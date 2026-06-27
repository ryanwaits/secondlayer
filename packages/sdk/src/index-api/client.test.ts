import { afterEach, describe, expect, mock, test } from "bun:test";
import { Index } from "./client.ts";

const BASE_URL = "http://localhost:3800";
const originalFetch = globalThis.fetch;

function recorder(body: unknown = {}) {
	const urls: string[] = [];
	globalThis.fetch = mock((input: string | URL | Request) => {
		urls.push(typeof input === "string" ? input : input.toString());
		return Promise.resolve({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(JSON.stringify(body)),
		} as Response);
	}) as unknown as typeof fetch;
	return urls;
}

describe("Index trait filter + discover", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("events.list forwards trait as ?trait=", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).events.list({
			eventType: "ft_transfer",
			trait: "sip-010",
		});
		expect(urls[0]).toContain("/v1/index/events");
		expect(urls[0]).toContain("event_type=ft_transfer");
		expect(urls[0]).toContain("trait=sip-010");
	});

	test("contractCalls.list forwards trait", async () => {
		const urls = recorder({
			contract_calls: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).contractCalls.list({
			trait: "sip-010",
		});
		expect(urls[0]).toContain("/v1/index/contract-calls");
		expect(urls[0]).toContain("trait=sip-010");
	});

	test("discover hits GET /v1/index", async () => {
		const urls = recorder({ event_type_filters: { ft_transfer: {} } });
		const doc = await new Index({ baseUrl: BASE_URL }).discover();
		expect(urls[0]).toMatch(/\/v1\/index($|\?)/);
		expect(doc.event_type_filters).toBeDefined();
	});

	test("transactions.getProof hits the /proof path", async () => {
		const urls = recorder({
			raw_tx: "00",
			raw_header: "00",
			tx_merkle_path: [],
		});
		const proof = await new Index({ baseUrl: BASE_URL }).transactions.getProof(
			"0xabc",
		);
		expect(urls[0]).toContain("/v1/index/transactions/0xabc/proof");
		expect(proof).not.toBeNull();
	});

	test("printSchema hits the contract print-schema path", async () => {
		const urls = recorder({
			contract_id: "SP1.registry",
			topics: [],
			sampled: false,
			total_events: 0,
			total_events_capped: false,
			sample: { size: 0, newest_height: null, oldest_height: null },
			tip: {},
		});
		const schema = await new Index({ baseUrl: BASE_URL }).printSchema(
			"SP1.registry",
		);
		expect(urls[0]).toContain("/v1/index/contracts/SP1.registry/print-schema");
		expect(schema?.topics).toEqual([]);
	});

	test("printSchema resolves null on 404", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 404,
				headers: new Headers(),
				json: () => Promise.resolve({ error: "not found" }),
				text: () => Promise.resolve('{"error":"not found"}'),
			} as Response),
		) as unknown as typeof fetch;
		const schema = await new Index({ baseUrl: BASE_URL }).printSchema(
			"SP1.missing",
		);
		expect(schema).toBeNull();
	});

	test("transactions.getProof resolves null on 404", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 404,
				headers: new Headers(),
				json: () => Promise.resolve({ error: "not found" }),
				text: () => Promise.resolve('{"error":"not found"}'),
			} as Response),
		) as unknown as typeof fetch;
		const proof = await new Index({ baseUrl: BASE_URL }).transactions.getProof(
			"0xmissing",
		);
		expect(proof).toBeNull();
	});
});

describe("Index events tx_context", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const emptyEvents = { events: [], next_cursor: null, tip: {}, reorgs: [] };

	test("events.list forwards txContext as tx_context=true", async () => {
		const urls = recorder(emptyEvents);
		await new Index({ baseUrl: BASE_URL }).events.list({
			eventType: "print",
			txContext: true,
		});
		expect(urls[0]).toContain("tx_context=true");
	});

	test("omitted txContext sends no tx_context param", async () => {
		const urls = recorder(emptyEvents);
		await new Index({ baseUrl: BASE_URL }).events.list({
			eventType: "print",
		});
		expect(urls[0]).not.toContain("tx_context");
	});

	test("events.walk forwards tx_context=true", async () => {
		const urls = recorder(emptyEvents);
		const it = new Index({ baseUrl: BASE_URL }).events.walk({
			eventType: "print",
			txContext: true,
		});
		// drain the (empty) generator — issues exactly the first page fetch
		for await (const _ of it) {
		}
		expect(urls[0]).toContain("tx_context=true");
	});

	test("events.consume threads tx_context=true into its page fetch", async () => {
		const urls = recorder(emptyEvents);
		await new Index({ baseUrl: BASE_URL }).events.consume({
			eventType: "print",
			txContext: true,
			fromHeight: 0,
			mode: "bounded", // return on the first empty page instead of tailing forever
			onBatch: async (_events, _envelope, ctx) => ctx.cursor,
		});
		expect(urls.length).toBeGreaterThan(0);
		expect(urls[0]).toContain("tx_context=true");
	});
});

describe("Index sBTC peg accessors", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const emptyDeposits = {
		deposits: [],
		next_cursor: null,
		tip: {},
		reorgs: [],
	};
	const emptyWithdrawals = {
		withdrawals: [],
		next_cursor: null,
		tip: {},
		reorgs: [],
	};
	const emptySbtcEvents = {
		events: [],
		next_cursor: null,
		tip: {},
		reorgs: [],
	};

	test("sbtc.deposits.list hits the deposits path with filters", async () => {
		const urls = recorder(emptyDeposits);
		await new Index({ baseUrl: BASE_URL }).sbtc.deposits.list({
			confirmed: true,
			sender: "SP1",
			limit: 50,
		});
		expect(urls[0]).toContain("/v1/index/sbtc/deposits");
		expect(urls[0]).toContain("confirmed=true");
		expect(urls[0]).toContain("sender=SP1");
		expect(urls[0]).toContain("limit=50");
	});

	test("sbtc.deposits omits confirmed when not set", async () => {
		const urls = recorder(emptyDeposits);
		await new Index({ baseUrl: BASE_URL }).sbtc.deposits.list({});
		expect(urls[0]).toContain("/v1/index/sbtc/deposits");
		expect(urls[0]).not.toContain("confirmed");
	});

	test("sbtc.deposits.get hits the by-bitcoin-txid path and unwraps", async () => {
		const urls = recorder({
			deposit: { bitcoin_txid: "0xbtc", status: "COMPLETED" },
			tip: {},
		});
		const res = await new Index({ baseUrl: BASE_URL }).sbtc.deposits.get(
			"0xbtc",
		);
		expect(urls[0]).toContain("/v1/index/sbtc/deposits/0xbtc");
		expect(res?.deposit.status).toBe("COMPLETED");
	});

	test("sbtc.deposits.get resolves null on 404", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 404,
				headers: new Headers(),
				json: () => Promise.resolve({ error: "Deposit not found" }),
				text: () => Promise.resolve('{"error":"Deposit not found"}'),
			} as Response),
		) as unknown as typeof fetch;
		const res = await new Index({ baseUrl: BASE_URL }).sbtc.deposits.get(
			"0xmissing",
		);
		expect(res).toBeNull();
	});

	test("sbtc.withdrawals.list forwards status + request_id", async () => {
		const urls = recorder(emptyWithdrawals);
		await new Index({ baseUrl: BASE_URL }).sbtc.withdrawals.list({
			status: "ACCEPTED",
			requestId: 7,
		});
		expect(urls[0]).toContain("/v1/index/sbtc/withdrawals");
		expect(urls[0]).toContain("status=ACCEPTED");
		expect(urls[0]).toContain("request_id=7");
	});

	test("sbtc.withdrawals.get hits the by-request-id path", async () => {
		const urls = recorder({
			withdrawal: { request_id: 7, status: "ACCEPTED", finalized: true },
			tip: {},
		});
		const res = await new Index({ baseUrl: BASE_URL }).sbtc.withdrawals.get(7);
		expect(urls[0]).toContain("/v1/index/sbtc/withdrawals/7");
		expect(res?.withdrawal.request_id).toBe(7);
	});

	test("sbtc.withdrawals.get resolves null on 404", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 404,
				headers: new Headers(),
				json: () => Promise.resolve({ error: "Withdrawal not found" }),
				text: () => Promise.resolve('{"error":"Withdrawal not found"}'),
			} as Response),
		) as unknown as typeof fetch;
		const res = await new Index({ baseUrl: BASE_URL }).sbtc.withdrawals.get(
			404,
		);
		expect(res).toBeNull();
	});

	test("sbtc.events.list forwards topic + bitcoin_txid", async () => {
		const urls = recorder(emptySbtcEvents);
		await new Index({ baseUrl: BASE_URL }).sbtc.events.list({
			topic: "completed-deposit",
			bitcoinTxid: "0xbtc",
		});
		expect(urls[0]).toContain("/v1/index/sbtc/events");
		expect(urls[0]).toContain("topic=completed-deposit");
		expect(urls[0]).toContain("bitcoin_txid=0xbtc");
	});

	test("sbtc.events.walk issues the first page fetch", async () => {
		const urls = recorder(emptySbtcEvents);
		const it = new Index({ baseUrl: BASE_URL }).sbtc.events.walk({
			topic: "completed-deposit",
		});
		for await (const _ of it) {
		}
		expect(urls[0]).toContain("/v1/index/sbtc/events");
		expect(urls[0]).toContain("topic=completed-deposit");
	});

	test("sbtc.summary hits the summary path and unwraps", async () => {
		const urls = recorder({
			summary: { total_deposits: 3, sbtc_supply_sats: "100" },
			tip: {},
		});
		const res = await new Index({ baseUrl: BASE_URL }).sbtc.summary();
		expect(urls[0]).toContain("/v1/index/sbtc/summary");
		expect(res.summary.total_deposits).toBe(3);
	});
});
