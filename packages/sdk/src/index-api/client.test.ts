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

describe("Index PoX-5 accessors", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const emptyPox5Events = {
		events: [],
		next_cursor: null,
		tip: {},
		reorgs: [],
	};

	test("pox5.events.list maps camelCase params to the snake_case wire", async () => {
		const urls = recorder(emptyPox5Events);
		await new Index({ baseUrl: BASE_URL }).pox5.events.list({
			topic: "stake",
			bondIndex: 3,
			signerManager: "SP_MANAGER",
			rewardCycle: 97,
		});
		expect(urls[0]).toContain("/v1/index/pox5/events");
		expect(urls[0]).toContain("topic=stake");
		expect(urls[0]).toContain("bond_index=3");
		expect(urls[0]).toContain("signer_manager=SP_MANAGER");
		expect(urls[0]).toContain("reward_cycle=97");
	});

	test("pox5.events.walk follows next_cursor across two pages, then stops", async () => {
		const urls: string[] = [];
		const page = (cursor: string | null, count: number) => ({
			events: Array.from({ length: count }, (_, i) => ({
				cursor: `${i}`,
				topic: "stake",
			})),
			next_cursor: cursor,
			tip: {},
			reorgs: [],
		});
		// Page length never ends a walk (the server clamps oversized limits
		// silently); only a null or repeated next_cursor does, so the short
		// second page costs one more fetch that comes back empty.
		const bodies = [page("100:1", 2), page("200:1", 1)];
		globalThis.fetch = mock((input: string | URL | Request) => {
			urls.push(typeof input === "string" ? input : input.toString());
			const body = bodies[urls.length - 1] ?? page(null, 0);
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({ "content-type": "application/json" }),
				json: () => Promise.resolve(body),
				text: () => Promise.resolve(JSON.stringify(body)),
			} as Response);
		}) as unknown as typeof fetch;

		const seen: unknown[] = [];
		for await (const event of new Index({ baseUrl: BASE_URL }).pox5.events.walk(
			{
				batchSize: 2,
			},
		)) {
			seen.push(event);
		}
		expect(urls).toHaveLength(3);
		expect(urls[0]).toContain("/v1/index/pox5/events");
		// Second page resumes from the first page's next_cursor.
		expect(urls[1]).toContain("cursor=100%3A1");
		expect(urls[2]).toContain("cursor=200%3A1");
		expect(seen).toHaveLength(3);
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

	test("ftTransfers.list forwards fields as a comma-joined param", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).ftTransfers.list({
			fields: ["amount", "sender"],
		});
		expect(decodeURIComponent(urls[0])).toContain("fields=amount,sender");
	});

	test("nftTransfers.walk forwards fields on every page request", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		for await (const _ of new Index({ baseUrl: BASE_URL }).nftTransfers.walk({
			fields: ["value"],
		})) {
			// drain
		}
		expect(decodeURIComponent(urls[0])).toContain("fields=value");
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

describe("Index walk resilience", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const envelope = (ids: string[], next: string | null) => ({
		events: ids.map((tx_id) => ({ tx_id })),
		next_cursor: next,
		tip: {},
		reorgs: [],
	});
	const ok = (body: unknown) =>
		Promise.resolve({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(JSON.stringify(body)),
		} as Response);

	test("walk yields every page when the server clamps pages below batchSize", async () => {
		// Server caps every page at 2 rows no matter the requested limit and
		// keeps sending a cursor until the feed is exhausted.
		const pages = [
			envelope(["0x1", "0x2"], "c2"),
			envelope(["0x3", "0x4"], "c4"),
			envelope(["0x5"], "c5"),
			envelope([], null),
		];
		const urls: string[] = [];
		globalThis.fetch = mock((input: string | URL | Request) => {
			urls.push(typeof input === "string" ? input : input.toString());
			return ok(pages[urls.length - 1] ?? envelope([], null));
		}) as unknown as typeof fetch;

		const ids: string[] = [];
		for await (const ev of new Index({ baseUrl: BASE_URL }).ftTransfers.walk({
			batchSize: 1000,
		})) {
			ids.push(ev.tx_id);
		}
		expect(ids).toEqual(["0x1", "0x2", "0x3", "0x4", "0x5"]);
		expect(urls).toHaveLength(4);
		expect(urls[0]).toContain("limit=1000");
	});

	test("walk rejects a batchSize above the 1000-row page cap with ValidationError", async () => {
		const urls = recorder(envelope([], null));
		const iterate = async () => {
			for await (const _ of new Index({ baseUrl: BASE_URL }).events.walk({
				eventType: "print",
				batchSize: 5000,
			})) {
				// unreachable
			}
		};
		await expect(iterate()).rejects.toMatchObject({
			name: "ValidationError",
			retryable: false,
		});
		await expect(iterate()).rejects.toThrow("1000");
		expect(urls).toHaveLength(0);
	});

	test("pox.cycles.walk defaults to 200 per page like every other feed", async () => {
		const urls = recorder({ cycles: [], next_cursor: null, tip: {} });
		for await (const _ of new Index({ baseUrl: BASE_URL }).pox.cycles.walk()) {
			// empty feed
		}
		expect(urls[0]).toContain("limit=200");
	});

	test("walk completes after a 503 page is retried", async () => {
		const seen: unknown[] = [];
		const bodies = [envelope(["0x1"], "c1"), null, envelope(["0x2"], null)];
		let calls = 0;
		globalThis.fetch = mock(() => {
			const body = bodies[calls++];
			if (body === null) {
				return Promise.resolve({
					ok: false,
					status: 503,
					headers: new Headers(),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve("upstream unavailable"),
				} as Response);
			}
			return ok(body);
		}) as unknown as typeof fetch;

		const ids: string[] = [];
		for await (const ev of new Index({ baseUrl: BASE_URL }).ftTransfers.walk({
			retryDelay: 1,
			onError: (err) => seen.push(err),
		})) {
			ids.push(ev.tx_id);
		}
		expect(ids).toEqual(["0x1", "0x2"]);
		expect(calls).toBe(3);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ status: 503, retryable: true });
	});

	test("walk gives up after retryCount failures and rethrows the last error", async () => {
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: false,
				status: 503,
				headers: new Headers(),
				json: () => Promise.resolve({}),
				text: () => Promise.resolve(""),
			} as Response),
		) as unknown as typeof fetch;
		const iterate = async () => {
			for await (const _ of new Index({ baseUrl: BASE_URL }).ftTransfers.walk({
				retryCount: 1,
				retryDelay: 1,
			})) {
				// never yields
			}
		};
		await expect(iterate()).rejects.toMatchObject({ status: 503 });
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	test("aborting mid-walk cancels the in-flight page and rejects with AbortError", async () => {
		const controller = new AbortController();
		let calls = 0;
		globalThis.fetch = mock((_input: unknown, init?: RequestInit) => {
			calls++;
			if (calls === 1) return ok(envelope(["0x1"], "c1"));
			// Second page hangs; honour the signal like a real fetch would.
			return new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				);
			});
		}) as unknown as typeof fetch;

		const ids: string[] = [];
		const iterate = async () => {
			for await (const ev of new Index({
				baseUrl: BASE_URL,
			}).ftTransfers.walk({ signal: controller.signal })) {
				ids.push(ev.tx_id);
				setTimeout(() => controller.abort(), 5);
			}
		};
		await expect(iterate()).rejects.toMatchObject({ name: "AbortError" });
		expect(ids).toEqual(["0x1"]);
		expect(calls).toBe(2);
	});

	test("aborting between yields rejects instead of ending the walk cleanly", async () => {
		const controller = new AbortController();
		globalThis.fetch = mock(() =>
			ok(envelope(["0x1", "0x2", "0x3"], null)),
		) as unknown as typeof fetch;

		const ids: string[] = [];
		const iterate = async () => {
			for await (const ev of new Index({
				baseUrl: BASE_URL,
			}).ftTransfers.walk({ signal: controller.signal })) {
				ids.push(ev.tx_id);
				controller.abort();
			}
		};
		await expect(iterate()).rejects.toMatchObject({ name: "AbortError" });
		expect(ids).toEqual(["0x1"]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	test("aborting before the first page rejects with the signal's reason", async () => {
		const controller = new AbortController();
		const reason = new Error("caller gave up");
		controller.abort(reason);
		globalThis.fetch = mock(() =>
			ok(envelope(["0x1"], null)),
		) as unknown as typeof fetch;

		const iterate = async () => {
			for await (const _ of new Index({
				baseUrl: BASE_URL,
			}).ftTransfers.walk({ signal: controller.signal })) {
				// unreachable
			}
		};
		await expect(iterate()).rejects.toBe(reason);
		expect(globalThis.fetch).toHaveBeenCalledTimes(0);
	});

	test("a hung page request times out into a retryable error the walk retries", async () => {
		let calls = 0;
		globalThis.fetch = mock(() => {
			calls++;
			if (calls === 1) return new Promise<Response>(() => {});
			return ok(envelope(["0x1"], null));
		}) as unknown as typeof fetch;

		const errors: unknown[] = [];
		const ids: string[] = [];
		for await (const ev of new Index({
			baseUrl: BASE_URL,
			requestTimeoutMs: 10,
		}).ftTransfers.walk({
			retryDelay: 1,
			onError: (err) => errors.push(err),
		})) {
			ids.push(ev.tx_id);
		}
		expect(ids).toEqual(["0x1"]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			code: "REQUEST_TIMEOUT",
			retryable: true,
		});
	});
});

describe("multi-contract scope", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("events.list serializes a contract_id list as a comma string", async () => {
		const urls = recorder({
			events: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).events.list({
			eventType: "print",
			contractId: ["SP1.a", "SP2.b", "SP3.c"],
		});
		expect(urls[0]).toContain("contract_id=SP1.a%2CSP2.b%2CSP3.c");
	});

	test("contractCalls.list accepts a single id unchanged", async () => {
		const urls = recorder({
			contract_calls: [],
			next_cursor: null,
			tip: {},
			reorgs: [],
		});
		await new Index({ baseUrl: BASE_URL }).contractCalls.list({
			contractId: "SP1.only",
		});
		expect(urls[0]).toContain("contract_id=SP1.only");
		expect(urls[0]).not.toContain("%2C");
	});
});
