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

	test("sbtc.withdrawals.list maps settlementConfirmed → settlement_confirmed", async () => {
		const urls = recorder(emptyWithdrawals);
		await new Index({ baseUrl: BASE_URL }).sbtc.withdrawals.list({
			settlementConfirmed: true,
		});
		expect(urls[0]).toContain("settlement_confirmed=true");
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

describe("Index PoX cycles accessors", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const emptyCycles = { cycles: [], next_cursor: null, tip: {} };

	test("pox.cycles.list forwards cursor + limit", async () => {
		const urls = recorder(emptyCycles);
		await new Index({ baseUrl: BASE_URL }).pox.cycles.list({
			cursor: 80,
			limit: 10,
		});
		expect(urls[0]).toContain("/v1/index/pox/cycles");
		expect(urls[0]).toContain("cursor=80");
		expect(urls[0]).toContain("limit=10");
	});

	test("pox.cycles.get hits the by-reward-cycle path and unwraps", async () => {
		const urls = recorder({
			cycle: { reward_cycle: 80, is_current: false },
			tip: {},
		});
		const res = await new Index({ baseUrl: BASE_URL }).pox.cycles.get(80);
		expect(urls[0]).toContain("/v1/index/pox/cycles/80");
		expect(res?.cycle.reward_cycle).toBe(80);
	});

	test("pox.cycles.get resolves null on 404", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 404,
				headers: new Headers(),
				json: () => Promise.resolve({ error: "not_found" }),
				text: () => Promise.resolve('{"error":"not_found"}'),
			} as Response),
		) as unknown as typeof fetch;
		const res = await new Index({ baseUrl: BASE_URL }).pox.cycles.get(999);
		expect(res).toBeNull();
	});

	test("pox.cycles.walk pages by numeric next_cursor then stops", async () => {
		// Two cycles, batchSize 1 → first page returns next_cursor, second ends it.
		const responses = [
			{ cycles: [{ reward_cycle: 80 }], next_cursor: 79, tip: {} },
			{ cycles: [{ reward_cycle: 79 }], next_cursor: null, tip: {} },
		];
		const urls: string[] = [];
		let call = 0;
		globalThis.fetch = mock((input: string | URL | Request) => {
			urls.push(typeof input === "string" ? input : input.toString());
			const body = responses[call++] ?? emptyCycles;
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({ "content-type": "application/json" }),
				json: () => Promise.resolve(body),
				text: () => Promise.resolve(JSON.stringify(body)),
			} as Response);
		}) as unknown as typeof fetch;

		const seen: number[] = [];
		for await (const c of new Index({ baseUrl: BASE_URL }).pox.cycles.walk({
			batchSize: 1,
		})) {
			seen.push(c.reward_cycle);
		}
		expect(seen).toEqual([80, 79]);
		expect(urls[1]).toContain("cursor=79");
	});
});

describe("Index list param forwarding", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const emptyEvents = { events: [], next_cursor: null, tip: {}, reorgs: [] };

	test("ftTransfers.list forwards contract_id + from_height + to_height", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).ftTransfers.list({
			contractId: "SP1.token",
			fromHeight: 100,
			toHeight: 200,
		});
		expect(urls[0]).toContain("/v1/index/ft-transfers");
		expect(decodeURIComponent(urls[0])).toContain("contract_id=SP1.token");
		expect(urls[0]).toContain("from_height=100");
		expect(urls[0]).toContain("to_height=200");
	});

	test("nftTransfers.list forwards contract_id + asset_identifier", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).nftTransfers.list({
			contractId: "SP1.nft",
			assetIdentifier: "SP1.nft::asset",
		});
		expect(urls[0]).toContain("/v1/index/nft-transfers");
		expect(decodeURIComponent(urls[0])).toContain("contract_id=SP1.nft");
		expect(decodeURIComponent(urls[0])).toContain(
			"asset_identifier=SP1.nft::asset",
		);
	});

	test("events.list forwards event_type + contract_id + from_height", async () => {
		const urls = recorder(emptyEvents);
		await new Index({ baseUrl: BASE_URL }).events.list({
			eventType: "ft_transfer",
			contractId: "SP1.x",
			fromHeight: 5,
		});
		expect(urls[0]).toContain("event_type=ft_transfer");
		expect(decodeURIComponent(urls[0])).toContain("contract_id=SP1.x");
		expect(urls[0]).toContain("from_height=5");
	});

	test("contractCalls.list forwards contract_id + function_name", async () => {
		const urls = recorder({
			contract_calls: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).contractCalls.list({
			contractId: "SP1.amm",
			functionName: "swap",
		});
		expect(urls[0]).toContain("/v1/index/contract-calls");
		expect(decodeURIComponent(urls[0])).toContain("contract_id=SP1.amm");
		expect(urls[0]).toContain("function_name=swap");
	});

	test("canonical.list forwards from_height + to_height", async () => {
		const urls = recorder({
			canonical: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).canonical.list({
			fromHeight: 10,
			toHeight: 20,
		});
		expect(urls[0]).toContain("/v1/index/canonical");
		expect(urls[0]).toContain("from_height=10");
		expect(urls[0]).toContain("to_height=20");
	});

	test("blocks.list forwards from_height + to_height", async () => {
		const urls = recorder({
			blocks: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).blocks.list({
			fromHeight: 1,
			toHeight: 2,
		});
		expect(urls[0]).toContain("/v1/index/blocks");
		expect(urls[0]).toContain("from_height=1");
		expect(urls[0]).toContain("to_height=2");
	});

	test("transactions.list forwards type + contract_id + sender", async () => {
		const urls = recorder({
			transactions: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).transactions.list({
			type: "contract_call",
			contractId: "SP1.y",
			sender: "SP2",
		});
		expect(urls[0]).toContain("/v1/index/transactions");
		expect(urls[0]).toContain("type=contract_call");
		expect(decodeURIComponent(urls[0])).toContain("contract_id=SP1.y");
		expect(urls[0]).toContain("sender=SP2");
	});

	test("stacking.list forwards function_name + stacker + caller", async () => {
		const urls = recorder({
			stacking: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).stacking.list({
			functionName: "stack-stx",
			stacker: "SP3",
			caller: "SP4",
		});
		expect(urls[0]).toContain("/v1/index/stacking");
		expect(urls[0]).toContain("function_name=stack-stx");
		expect(urls[0]).toContain("stacker=SP3");
		expect(urls[0]).toContain("caller=SP4");
	});

	test("mempool.list forwards sender + type + contract_id", async () => {
		const urls = recorder({
			mempool: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).mempool.list({
			sender: "SP5",
			type: "token_transfer",
			contractId: "SP1.z",
		});
		expect(urls[0]).toContain("/v1/index/mempool");
		expect(urls[0]).toContain("sender=SP5");
		expect(urls[0]).toContain("type=token_transfer");
		expect(decodeURIComponent(urls[0])).toContain("contract_id=SP1.z");
	});
});

describe("Index walk termination", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("ftTransfers.walk pages then stops on null next_cursor", async () => {
		const responses = [
			{ events: [{ tx_id: "0x1" }], next_cursor: "c2", tip: {}, reorgs: [] },
			{ events: [{ tx_id: "0x2" }], next_cursor: null, tip: {}, reorgs: [] },
		];
		const urls: string[] = [];
		let call = 0;
		globalThis.fetch = mock((input: string | URL | Request) => {
			urls.push(typeof input === "string" ? input : input.toString());
			const body = responses[call++] ?? {
				events: [],
				next_cursor: null,
				tip: {},
				reorgs: [],
			};
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({ "content-type": "application/json" }),
				json: () => Promise.resolve(body),
				text: () => Promise.resolve(JSON.stringify(body)),
			} as Response);
		}) as unknown as typeof fetch;

		const ids: string[] = [];
		for await (const ev of new Index({ baseUrl: BASE_URL }).ftTransfers.walk({
			batchSize: 1,
		})) {
			ids.push(ev.tx_id);
		}
		expect(ids).toEqual(["0x1", "0x2"]);
		expect(urls.length).toBe(2);
		expect(urls[1]).toContain("cursor=c2");
	});

	test("events.walk stops immediately on empty first page", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		const items: unknown[] = [];
		for await (const ev of new Index({ baseUrl: BASE_URL }).events.walk({
			eventType: "print",
		})) {
			items.push(ev);
		}
		expect(items).toEqual([]);
		expect(urls.length).toBe(1);
	});
});
