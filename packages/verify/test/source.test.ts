import { describe, expect, test } from "bun:test";
import {
	NodeRpcProofSource,
	type ProofSource,
	SecondlayerProofSource,
	SourceError,
	hex,
} from "../src/index.ts";

type Handler = (url: URL, headers: Headers) => Response;

/** A fetch that records requests and answers from `handler`. */
function mockFetch(handler: Handler) {
	const calls: { url: string; auth: string | null }[] = [];
	const fetch = async (url: string, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		calls.push({ url, auth: headers.get("authorization") });
		return handler(new URL(url), headers);
	};
	return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
const bytes = (b: Uint8Array) => new Response(b);

const BASE = "https://api.example";
const ID = "ab".repeat(32);

describe("SecondlayerProofSource", () => {
	const routes: Handler = (url) => {
		const p = url.pathname;
		if (p === `/v1/proofs/block/${ID}`) return bytes(Uint8Array.of(1, 2));
		if (p === "/v1/proofs/block/height/7") return bytes(Uint8Array.of(7));
		if (p === `/v1/proofs/witness/${ID}`) return bytes(Uint8Array.of(3));
		if (p === `/v1/proofs/epoch2-header/${ID}`)
			return json([
				{ header: "0700", consensus_hash: "dd", parent_block_id: ID },
			]);
		if (p.startsWith("/v1/proofs/marf/aa"))
			return json({ data: "0x01", proof: "0a0b" });
		if (p.startsWith("/v1/proofs/marf/")) return json({ error: "nf" }, 404);
		if (p === "/v1/proofs/burn/cc")
			return json({
				consensus_hash: "cc",
				burn_height: 970269,
				bitcoin_block_hash: "00",
				preimage: "17000000",
			});
		if (p === "/v1/proofs/bitcoin-headers")
			return json({
				from: Number(url.searchParams.get("from")),
				headers: ["00".repeat(80)],
			});
		return json({ error: "nf" }, 404);
	};

	test("every proof route carries the account key as a bearer token", async () => {
		const m = mockFetch(routes);
		const s = new SecondlayerProofSource({
			baseUrl: `${BASE}/`,
			apiKey: "sk-sl_x",
			fetch: m.fetch,
		});
		expect(await s.getBlock(ID)).toEqual(Uint8Array.of(1, 2));
		expect(await s.getBlock(7)).toEqual(Uint8Array.of(7));
		expect(await s.getWitness(ID)).toEqual(Uint8Array.of(3));
		expect(await s.getEpoch2Header(ID)).toEqual({
			header: Uint8Array.of(7, 0),
			consensusHash: Uint8Array.of(0xdd),
		});
		expect(await s.getMarfProof("aa", ID)).toEqual({
			data: "0x01",
			proof: Uint8Array.of(10, 11),
		});
		expect(await s.getBurnPreimage("cc")).toEqual({
			preimage: Uint8Array.of(23, 0, 0, 0),
			burnHeight: 970269,
		});
		expect(await s.getBitcoinHeaders(967681, 1)).toEqual(["00".repeat(80)]);
		expect(m.calls.map((c) => c.url)).toEqual([
			`${BASE}/v1/proofs/block/${ID}`,
			`${BASE}/v1/proofs/block/height/7`,
			`${BASE}/v1/proofs/witness/${ID}`,
			`${BASE}/v1/proofs/epoch2-header/${ID}`,
			`${BASE}/v1/proofs/marf/aa?tip=${ID}`,
			`${BASE}/v1/proofs/burn/cc`,
			`${BASE}/v1/proofs/bitcoin-headers?from=967681&count=1`,
		]);
		expect(m.calls.every((c) => c.auth === "Bearer sk-sl_x")).toBe(true);
	});

	test("an absent MARF key is null; other 404s are errors", async () => {
		const s = new SecondlayerProofSource({
			baseUrl: BASE,
			apiKey: "k",
			fetch: mockFetch(routes).fetch,
		});
		expect(await s.getMarfProof("bb", ID)).toBeNull();
		await expect(s.getWitness("ff")).rejects.toBeInstanceOf(SourceError);
		// A Nakamoto or unknown id has no 2.x header: an error, never a guess.
		await expect(s.getEpoch2Header("ff")).rejects.toBeInstanceOf(SourceError);
	});

	test("a busy witness slot is retried after retry-after", async () => {
		let n = 0;
		const m = mockFetch(() =>
			++n < 3
				? new Response("busy", {
						status: 503,
						headers: { "retry-after": "0" },
					})
				: bytes(Uint8Array.of(9)),
		);
		const s = new SecondlayerProofSource({
			baseUrl: BASE,
			apiKey: "k",
			fetch: m.fetch,
		});
		expect(await s.getWitness(ID)).toEqual(Uint8Array.of(9));
		expect(m.calls.length).toBe(3);
	});

	test("state_writes follow next_cursor; a 404 means none for the block", async () => {
		const row = (ordinal: number) => ({
			tx_index: 0,
			ordinal,
			key: `k${ordinal}`,
			value_hex: "30",
		});
		const m = mockFetch((url) => {
			if (url.searchParams.get("block_height") === "5")
				return json({ error: "nf" }, 404);
			return url.searchParams.get("cursor") === "c1"
				? json({ state_writes: [row(1000)], next_cursor: "c2" })
				: json({
						state_writes: Array.from({ length: 1000 }, (_, i) => row(i)),
						next_cursor: "c1",
					});
		});
		const s = new SecondlayerProofSource({
			baseUrl: BASE,
			apiKey: "k",
			fetch: m.fetch,
		});
		expect((await s.getStateWrites(9))?.length).toBe(1001);
		expect(m.calls[0]?.url).toBe(
			`${BASE}/v1/index/state-writes?block_height=9&limit=1000`,
		);
		expect(await s.getStateWrites(5)).toBeNull();
	});

	test("vm_events come from one Index read per write type, in ordinal order", async () => {
		const m = mockFetch((url) => {
			const type = url.searchParams.get("event_type");
			const at = { var_set: 4, map_set: 1, map_insert: 3, map_delete: 2 };
			return json({
				events: [
					{
						event_type: type,
						event_index: at[type as keyof typeof at],
						contract_id: "SP1.c",
					},
				],
				next_cursor: null,
			});
		});
		const s = new SecondlayerProofSource({
			baseUrl: BASE,
			apiKey: "k",
			fetch: m.fetch,
		});
		const rows = await s.getVmEvents(12);
		expect(rows.map((r) => r.event_index)).toEqual([1, 2, 3, 4]);
		expect(m.calls[0]?.url).toBe(
			`${BASE}/v1/index/events?event_type=var_set&from_height=12&to_height=12&limit=1000`,
		);
	});
});

describe("NodeRpcProofSource", () => {
	test("reads blocks, 2.x headers and MARF proofs from node RPC and spreads over another source", async () => {
		const node = mockFetch((url) => {
			if (url.pathname === `/v3/blocks/${ID}`) return bytes(Uint8Array.of(4));
			if (url.pathname === "/v3/blocks/height/8")
				return bytes(Uint8Array.of(8));
			if (url.pathname === "/v2/headers/1")
				return json([{ header: "0701", consensus_hash: "ee" }]);
			return json({ data: "0x02", marf_proof: "0c" });
		});
		const api = mockFetch(() => bytes(Uint8Array.of(5)));
		const source: ProofSource = {
			...new SecondlayerProofSource({
				baseUrl: BASE,
				apiKey: "k",
				fetch: api.fetch,
			}),
			...new NodeRpcProofSource({
				nodeUrl: "http://node:20443",
				fetch: node.fetch,
			}),
		};
		expect(await source.getBlock(ID)).toEqual(Uint8Array.of(4));
		expect(await source.getBlock(8)).toEqual(Uint8Array.of(8));
		expect(await source.getMarfProof("aa", ID)).toEqual({
			data: "0x02",
			proof: Uint8Array.of(12),
		});
		expect(hex(await source.getWitness(ID))).toBe("05");
		const e2 = await source.getEpoch2Header?.(ID);
		expect(e2 && hex(e2.header)).toBe("0701");
		expect(node.calls.map((c) => c.url)).toEqual([
			`http://node:20443/v3/blocks/${ID}`,
			"http://node:20443/v3/blocks/height/8",
			`http://node:20443/v2/clarity/marf/aa?tip=${ID}&proof=1`,
			`http://node:20443/v2/headers/1?tip=${ID}`,
		]);
		expect(api.calls.map((c) => c.url)).toEqual([
			`${BASE}/v1/proofs/witness/${ID}`,
		]);
	});
});
