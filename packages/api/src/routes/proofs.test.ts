import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	bitcoinTxid,
	doubleSha256,
	merkleRoot,
	reverseBytes,
} from "@secondlayer/stacks/bitcoin";
import { Hono } from "hono";
import { _resetRateLimitStoreForTests } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";
import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
} from "../http/cache.ts";
import { INDEX_READ_SCOPE, type IndexTokenStore } from "../index/auth.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	PROOFS_RATE_LIMITS,
	type ProofsRouterOptions,
	createProofsRouter,
} from "./proofs.ts";

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

const ID = "ab".repeat(32);
const CH = "cd".repeat(20);
const MARF_PATH = "ef".repeat(32);
/** A path the fake node 404s, as a stock node does `__MARF_*` keys. */
const INTERNAL_MARF_PATH = "a9".repeat(32);
const SIDECAR_MARF = { data: `0x${ID}${"00".repeat(8)}`, proof: "0x01ee" };
const WITNESS = new Uint8Array([0x03, 0x00, 0xff, 0x10, 0x20]);
const BLOCK = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
const EPOCH2_HEADER = {
	consensus_hash: CH,
	header: "07".repeat(247),
	parent_block_id: "12".repeat(32),
};

const FREE_KEY = "sk-sl_proofs_free_fixture";
const INTERNAL_KEY = "sk-sl_proofs_internal_fixture";
const TOKENS: IndexTokenStore = new Map([
	[
		FREE_KEY,
		{
			tenant_id: "account:proofs-fixture",
			account_id: "proofs-fixture",
			tier: "free",
			scopes: [INDEX_READ_SCOPE],
		},
	],
	[
		INTERNAL_KEY,
		{
			tenant_id: "tenant_proofs_internal",
			tier: "internal",
			scopes: [INDEX_READ_SCOPE],
		},
	],
]);

/** What the fake sidecar and node were asked for, `path?query`. */
const seen: string[] = [];
let sidecarMode: "ok" | "busy" | "missing" = "ok";

const sidecar = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch(req) {
		const url = new URL(req.url);
		seen.push(`sidecar ${url.pathname}${url.search}`);
		if (sidecarMode === "busy") {
			return new Response("busy", {
				status: 503,
				headers: { "retry-after": "2" },
			});
		}
		if (sidecarMode === "missing") return new Response("no", { status: 404 });
		if (url.pathname.startsWith("/witness/")) {
			return new Response(WITNESS, {
				headers: {
					"content-type": "application/octet-stream",
					"x-block-height": "9137005",
					"x-state-root": "11".repeat(32),
					"x-internal-debug": "must not leak",
				},
			});
		}
		if (url.pathname.startsWith("/burn/")) {
			return Response.json({
				consensus_hash: CH,
				burn_height: 970269,
				bitcoin_block_hash: "00".repeat(32),
				preimage: "01".repeat(40),
			});
		}
		if (url.pathname.startsWith("/marf/")) {
			return Response.json(SIDECAR_MARF);
		}
		if (url.pathname === "/bitcoin/headers") {
			return Response.json({
				from: Number(url.searchParams.get("from")),
				headers: ["00".repeat(80)],
			});
		}
		return new Response("unexpected", { status: 500 });
	},
});

const node = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch(req) {
		const url = new URL(req.url);
		seen.push(`node ${url.pathname}${url.search}`);
		if (url.pathname.startsWith("/v3/blocks/")) {
			if (url.pathname.endsWith("/404404")) {
				return new Response("not found", { status: 404 });
			}
			return new Response(BLOCK, {
				headers: { "content-type": "application/octet-stream" },
			});
		}
		if (url.pathname === `/v2/clarity/marf/${INTERNAL_MARF_PATH}`) {
			return new Response("Marf key hash not found", { status: 404 });
		}
		if (url.pathname.startsWith("/v2/clarity/marf/")) {
			return Response.json({ data: "0x0100", proof: "0x00ff" });
		}
		if (url.pathname === "/v2/headers/1") {
			return Response.json([EPOCH2_HEADER]);
		}
		return new Response("unexpected", { status: 500 });
	},
});

const SIDECAR_URL = `http://127.0.0.1:${sidecar.port}`;
const NODE_URL = `http://127.0.0.1:${node.port}/`;

function app(opts: Partial<ProofsRouterOptions> = {}) {
	const a = new Hono();
	a.onError(errorHandler);
	a.route(
		"/v1/proofs",
		createProofsRouter({
			tokens: TOKENS,
			sidecarUrl: () => SIDECAR_URL,
			nodeRpcUrl: () => NODE_URL,
			...opts,
		}),
	);
	return a;
}

function get(
	path: string,
	key?: string,
	opts?: Partial<ProofsRouterOptions>,
	headers: Record<string, string> = {},
) {
	return app(opts).request(path, {
		headers: { ...headers, ...(key ? { authorization: `Bearer ${key}` } : {}) },
	});
}

let prevMode: string | undefined;
let prevSidecar: string | undefined;

beforeAll(() => {
	prevMode = process.env.INSTANCE_MODE;
	prevSidecar = process.env.PROOF_SIDECAR_URL;
});

afterAll(() => {
	sidecar.stop(true);
	node.stop(true);
	if (prevMode === undefined) delete process.env.INSTANCE_MODE;
	else process.env.INSTANCE_MODE = prevMode;
	if (prevSidecar === undefined) delete process.env.PROOF_SIDECAR_URL;
	else process.env.PROOF_SIDECAR_URL = prevSidecar;
});

beforeEach(async () => {
	process.env.INSTANCE_MODE = "oss";
	seen.length = 0;
	sidecarMode = "ok";
	await _resetRateLimitStoreForTests();
});

describe("proofs passthrough (self-hosted, loopback)", () => {
	test("witness streams the sidecar's bytes and verification headers, cached immutable", async () => {
		const res = await get(`/v1/proofs/witness/0x${ID.toUpperCase()}`);
		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(WITNESS);
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("x-block-height")).toBe("9137005");
		expect(res.headers.get("x-state-root")).toBe("11".repeat(32));
		expect(res.headers.get("x-internal-debug")).toBeNull();
		expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		// Bare lowercase hex is what the sidecar parses.
		expect(seen).toEqual([`sidecar /witness/${ID}`]);
	});

	test("self-host sets no rate limit headers", async () => {
		const res = await get(`/v1/proofs/block/${ID}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("x-ratelimit-limit")).toBeNull();
	});

	test("an unknown block is a 404 in the API's error envelope", async () => {
		sidecarMode = "missing";
		const res = await get(`/v1/proofs/witness/${ID}`);
		expect(res.status).toBe(404);
		expect(((await res.json()) as { code: string }).code).toBe("NOT_FOUND");
	});

	test("a busy sidecar is a 503 that keeps its retry-after", async () => {
		sidecarMode = "busy";
		const res = await get(`/v1/proofs/witness/${ID}`);
		expect(res.status).toBe(503);
		expect(res.headers.get("retry-after")).toBe("2");
		expect(((await res.json()) as { code: string }).code).toBe(
			"PROOF_SOURCE_BUSY",
		);
	});

	test("an unreachable sidecar is a 502", async () => {
		const res = await get(`/v1/proofs/witness/${ID}`, undefined, {
			sidecarUrl: () => "http://127.0.0.1:1",
		});
		expect(res.status).toBe(502);
		expect(((await res.json()) as { code: string }).code).toBe(
			"PROOF_SOURCE_ERROR",
		);
	});

	test("burn returns the sidecar's JSON, cached immutable", async () => {
		const res = await get(`/v1/proofs/burn/${CH}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		const body = (await res.json()) as { burn_height: number };
		expect(body.burn_height).toBe(970269);
		expect(seen).toEqual([`sidecar /burn/${CH}`]);
	});

	test("bitcoin-headers forwards from and count, short-cached", async () => {
		const res = await get("/v1/proofs/bitcoin-headers?from=967680&count=2016");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(MUTABLE_CACHE_CONTROL);
		expect(((await res.json()) as { from: number }).from).toBe(967680);
		expect(seen).toEqual(["sidecar /bitcoin/headers?from=967680&count=2016"]);
	});

	test("block by id is the node's raw bytes, cached immutable", async () => {
		const res = await get(`/v1/proofs/block/${ID}`);
		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BLOCK);
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(seen).toEqual([`node /v3/blocks/${ID}`]);
	});

	test("block by height is the node's raw bytes, never cached immutable", async () => {
		const res = await get("/v1/proofs/block/height/9137005");
		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BLOCK);
		expect(res.headers.get("cache-control")).toBe(MUTABLE_CACHE_CONTROL);
		expect(seen).toEqual(["node /v3/blocks/height/9137005"]);
	});

	test("a block the node lacks is a 404", async () => {
		const res = await get("/v1/proofs/block/height/404404");
		expect(res.status).toBe(404);
	});

	test("epoch2-header is the node's /v2/headers answer for that tip, cached immutable", async () => {
		const res = await get(`/v1/proofs/epoch2-header/0x${ID}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([EPOCH2_HEADER]);
		expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(seen).toEqual([`node /v2/headers/1?tip=${ID}`]);
	});

	test("marf asks the node for a proof pinned to the tip", async () => {
		const res = await get(`/v1/proofs/marf/0x${MARF_PATH}?tip=0x${ID}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ data: "0x0100", proof: "0x00ff" });
		expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(seen).toEqual([
			`node /v2/clarity/marf/${MARF_PATH}?tip=${ID}&proof=1`,
		]);
	});

	test("a MARF key the node 404s is proven by the sidecar, same shape, cached immutable", async () => {
		const res = await get(
			`/v1/proofs/marf/${INTERNAL_MARF_PATH}?tip=${ID.toUpperCase()}`,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(SIDECAR_MARF);
		expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(seen).toEqual([
			`node /v2/clarity/marf/${INTERNAL_MARF_PATH}?tip=${ID}&proof=1`,
			`sidecar /marf/${INTERNAL_MARF_PATH}?tip=${ID}`,
		]);
	});

	test("a MARF key neither source has is a 404", async () => {
		sidecarMode = "missing";
		const res = await get(`/v1/proofs/marf/${INTERNAL_MARF_PATH}?tip=${ID}`);
		expect(res.status).toBe(404);
		expect(((await res.json()) as { code: string }).code).toBe("NOT_FOUND");
		expect(seen).toHaveLength(2);
	});

	test("a MARF fallback to a busy sidecar is a 503 that keeps its retry-after", async () => {
		sidecarMode = "busy";
		const res = await get(`/v1/proofs/marf/${INTERNAL_MARF_PATH}?tip=${ID}`);
		expect(res.status).toBe(503);
		expect(res.headers.get("retry-after")).toBe("2");
	});

	test("without a sidecar, a MARF key the node 404s stays a 404", async () => {
		const res = await get(
			`/v1/proofs/marf/${INTERNAL_MARF_PATH}?tip=${ID}`,
			undefined,
			{ sidecarUrl: () => undefined },
		);
		expect(res.status).toBe(404);
		expect(((await res.json()) as { code: string }).code).toBe("NOT_FOUND");
		expect(seen).toEqual([
			`node /v2/clarity/marf/${INTERNAL_MARF_PATH}?tip=${ID}&proof=1`,
		]);
	});

	test("without a sidecar, sidecar routes are 503 and node routes still serve", async () => {
		const opts = { sidecarUrl: () => undefined };
		for (const path of [
			`/v1/proofs/witness/${ID}`,
			`/v1/proofs/burn/${CH}`,
			"/v1/proofs/bitcoin-headers?from=0&count=1",
		]) {
			const res = await get(path, undefined, opts);
			expect(res.status, path).toBe(503);
			expect(((await res.json()) as { code: string }).code).toBe(
				"PROOFS_UNAVAILABLE",
			);
		}
		expect((await get(`/v1/proofs/block/${ID}`, undefined, opts)).status).toBe(
			200,
		);
	});
});

describe("proofs param validation", () => {
	for (const path of [
		`/v1/proofs/witness/${ID.slice(2)}`,
		`/v1/proofs/witness/${"zz".repeat(32)}`,
		`/v1/proofs/witness/${ID}00`,
		`/v1/proofs/witness/${ID}?extra=1`,
		`/v1/proofs/burn/${ID}`,
		`/v1/proofs/burn/${CH.slice(1)}`,
		"/v1/proofs/bitcoin-headers?from=0&count=2017",
		"/v1/proofs/bitcoin-headers?from=0&count=0",
		"/v1/proofs/bitcoin-headers?count=1",
		"/v1/proofs/bitcoin-headers?from=-1&count=1",
		"/v1/proofs/bitcoin-headers?from=0",
		`/v1/proofs/block/${CH}`,
		`/v1/proofs/epoch2-header/${CH}`,
		`/v1/proofs/epoch2-header/${ID}?tip=${ID}`,
		"/v1/proofs/block/height/12a",
		"/v1/proofs/block/height/01",
		`/v1/proofs/marf/${MARF_PATH}`,
		`/v1/proofs/marf/${MARF_PATH}?tip=${CH}`,
		`/v1/proofs/marf/${CH}?tip=${ID}`,
	]) {
		test(`refuses ${path} without reaching a source`, async () => {
			const res = await get(path);
			expect(res.status).toBe(400);
			expect(((await res.json()) as { code: string }).code).toBe(
				"VALIDATION_ERROR",
			);
			expect(seen).toEqual([]);
		});
	}
});

describe("bitcoin-tx", () => {
	// A three-tx block whose header commits to the real merkle root of its txids.
	const RAW_TX = new Uint8Array(
		Buffer.from(
			[
				"01000000",
				"01",
				"11".repeat(32),
				"00000000",
				"00",
				"ffffffff",
				"01",
				"1027000000000000",
				"04",
				"deadbeef",
				"00000000",
			].join(""),
			"hex",
		),
	);
	const TXID_INTERNAL = bitcoinTxid(RAW_TX);
	const TXID = toHex(reverseBytes(TXID_INTERNAL));
	const OTHERS = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
	const BLOCK_TXIDS = [OTHERS[0], TXID_INTERNAL, OTHERS[1]] as Uint8Array[];
	const HEADER = new Uint8Array(80);
	HEADER.set(merkleRoot(BLOCK_TXIDS), 36);
	const BLOCK_HASH = toHex(reverseBytes(doubleSha256(HEADER)));
	const UNKNOWN = "ee".repeat(32);
	const UNCONFIRMED = "dd".repeat(32);

	const rpcSeen: string[] = [];
	const bitcoind = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(req) {
			const { method, params } = (await req.json()) as {
				method: string;
				params: unknown[];
			};
			rpcSeen.push(method);
			const reply = (result: unknown) =>
				Response.json({ result, error: null, id: "secondlayer" });
			const txid = params[0];
			if (method === "getrawtransaction") {
				if (txid === TXID) {
					return params[1] === true
						? reply({ txid, blockhash: BLOCK_HASH })
						: reply(toHex(RAW_TX));
				}
				if (txid === UNCONFIRMED) {
					return params[1] === true ? reply({ txid }) : reply(toHex(RAW_TX));
				}
				return Response.json(
					{
						result: null,
						error: {
							code: -5,
							message: "No such mempool or blockchain transaction",
						},
					},
					{ status: 500 },
				);
			}
			if (method === "getblock") {
				return reply({
					height: 968461,
					tx: BLOCK_TXIDS.map((t) => toHex(reverseBytes(t))),
				});
			}
			if (method === "getblockheader") return reply(toHex(HEADER));
			return new Response("unexpected", { status: 500 });
		},
	});
	afterAll(() => bitcoind.stop(true));
	beforeEach(() => {
		rpcSeen.length = 0;
	});

	const rpc = {
		bitcoinRpc: () => ({ url: `http://127.0.0.1:${bitcoind.port}` }),
	};

	test("returns the raw tx, merkle branch and header, short-cached", async () => {
		const res = await get(
			`/v1/proofs/bitcoin-tx/0x${TXID.toUpperCase()}`,
			undefined,
			rpc,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(MUTABLE_CACHE_CONTROL);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({
			txid: TXID,
			block_hash: BLOCK_HASH,
			block_height: 968461,
			header: toHex(HEADER),
			raw_tx: toHex(RAW_TX),
			tx_index: 1,
			tx_count: 3,
			siblings: [
				toHex(OTHERS[0] as Uint8Array),
				toHex(
					doubleSha256(
						new Uint8Array([
							...(OTHERS[1] as Uint8Array),
							...(OTHERS[1] as Uint8Array),
						]),
					),
				),
			],
		});
	});

	test("an unknown txid, which bitcoind answers with HTTP 500, is a 404", async () => {
		const res = await get(`/v1/proofs/bitcoin-tx/${UNKNOWN}`, undefined, rpc);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { code: string; error: string };
		expect(body.code).toBe("NOT_FOUND");
		expect(body.error).toContain("no Bitcoin transaction");
	});

	test("a transaction not in a block yet is a 404", async () => {
		const res = await get(
			`/v1/proofs/bitcoin-tx/${UNCONFIRMED}`,
			undefined,
			rpc,
		);
		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: string }).error).toContain(
			"not in a block",
		);
	});

	test("an unreachable bitcoind is a 502 that does not echo the RPC address", async () => {
		const res = await get(`/v1/proofs/bitcoin-tx/${TXID}`, undefined, {
			bitcoinRpc: () => ({ url: "http://127.0.0.1:1", auth: "c2VjcmV0" }),
		});
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(JSON.parse(text).code).toBe("PROOF_SOURCE_ERROR");
		expect(text).not.toContain("127.0.0.1");
		expect(text).not.toContain("c2VjcmV0");
	});

	test("a bitcoind that returns a tx from another block is a 502", async () => {
		const lying = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			async fetch(req) {
				const { method, params } = (await req.json()) as {
					method: string;
					params: unknown[];
				};
				const reply = (result: unknown) =>
					Response.json({ result, error: null });
				if (method === "getrawtransaction")
					return params[1] === true
						? reply({ blockhash: BLOCK_HASH })
						: reply(toHex(RAW_TX));
				if (method === "getblock")
					return reply({ height: 1, tx: [toHex(new Uint8Array(32).fill(7))] });
				return reply(toHex(HEADER));
			},
		});
		try {
			const res = await get(`/v1/proofs/bitcoin-tx/${TXID}`, undefined, {
				bitcoinRpc: () => ({ url: `http://127.0.0.1:${lying.port}` }),
			});
			expect(res.status).toBe(502);
		} finally {
			lying.stop(true);
		}
	});

	test("without BITCOIN_RPC_URL the route is 503 PROOFS_UNAVAILABLE", async () => {
		const res = await get(`/v1/proofs/bitcoin-tx/${TXID}`, undefined, {
			bitcoinRpc: () => undefined,
		});
		expect(res.status).toBe(503);
		const body = (await res.json()) as { code: string; error: string };
		expect(body.code).toBe("PROOFS_UNAVAILABLE");
		expect(body.error).toContain("BITCOIN_RPC_URL");
	});

	for (const path of [
		`/v1/proofs/bitcoin-tx/${TXID.slice(2)}`,
		`/v1/proofs/bitcoin-tx/${"zz".repeat(32)}`,
		`/v1/proofs/bitcoin-tx/${TXID}?extra=1`,
	]) {
		test(`refuses ${path} without reaching bitcoind`, async () => {
			const res = await get(path, undefined, rpc);
			expect(res.status).toBe(400);
			expect(((await res.json()) as { code: string }).code).toBe(
				"VALIDATION_ERROR",
			);
			expect(rpcSeen).toEqual([]);
		});
	}

	test("hosted anonymous requests carry rate limit headers", async () => {
		process.env.INSTANCE_MODE = "platform";
		const res = await get(`/v1/proofs/bitcoin-tx/${TXID}`, undefined, rpc);
		expect(res.status).toBe(200);
		expect(res.headers.get("x-ratelimit-limit")).toBe("10");
	});
});

describe("proofs on the hosted archive", () => {
	beforeEach(() => {
		process.env.INSTANCE_MODE = "platform";
	});

	const ANON = PROOFS_RATE_LIMITS.anonymous;
	const fromIp = (ip: string) => ({ "x-forwarded-for": ip });
	const block = (ip: string, key?: string) =>
		get(`/v1/proofs/block/${ID}`, key, undefined, fromIp(ip));
	const witness = (ip: string) =>
		get(`/v1/proofs/witness/${ID}`, undefined, undefined, fromIp(ip));

	test("no key is needed; an unknown key is served anonymously", async () => {
		const none = await get(`/v1/proofs/block/${ID}`);
		const unknown = await get(`/v1/proofs/block/${ID}`, "sk-sl_not_a_key");
		const keyed = await get(`/v1/proofs/block/${ID}`, FREE_KEY);
		expect([none.status, unknown.status, keyed.status]).toEqual([
			200, 200, 200,
		]);
		expect(none.headers.get("x-ratelimit-limit")).toBe("10");
		expect(unknown.headers.get("x-ratelimit-limit")).toBe("10");
		expect(keyed.headers.get("x-ratelimit-limit")).toBe("20");
	});

	test("anonymous callers get their own window per client IP", async () => {
		for (let i = 0; i < ANON.default.limit; i++) {
			expect((await block("203.0.113.7")).status).toBe(200);
		}
		const limited = await block("203.0.113.7");
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		expect((await block("203.0.113.8")).status).toBe(200);
	});

	test("the client IP is the proxy-appended last entry, so a forged first entry does not reset the window", async () => {
		for (let i = 0; i < ANON.default.limit; i++) {
			await block("1.1.1.1, 203.0.113.9");
		}
		expect((await block("9.9.9.9, 203.0.113.9")).status).toBe(429);
	});

	test("anonymous witness reads get 1 per second", async () => {
		expect((await witness("203.0.113.20")).status).toBe(200);
		expect((await witness("203.0.113.20")).status).toBe(429);
		expect(seen.filter((s) => s.startsWith("sidecar /witness"))).toHaveLength(
			1,
		);
	});

	test("an account key is never slower than anonymous", async () => {
		for (let i = 0; i < ANON.default.limit; i++) {
			await block("203.0.113.30");
		}
		expect((await block("203.0.113.30")).status).toBe(429);
		expect((await block("203.0.113.30", FREE_KEY)).status).toBe(200);
	});

	test("hash-addressed proofs carry an ETag and a matching If-None-Match is a 304 that never reaches the upstream", async () => {
		const revalidate = (path: string, tag: string) =>
			get(path, undefined, undefined, { "if-none-match": tag });

		const burn = await get(`/v1/proofs/burn/${CH}`);
		expect(burn.status).toBe(200);
		const burnTag = burn.headers.get("etag") ?? "";
		expect(burnTag).not.toBe("");
		const burn304 = await revalidate(`/v1/proofs/burn/${CH}`, burnTag);
		expect(burn304.status).toBe(304);
		expect(burn304.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(seen.filter((s) => s.startsWith("sidecar /burn"))).toHaveLength(1);

		const blockRes = await get(`/v1/proofs/block/${ID}`);
		const blockTag = blockRes.headers.get("etag") ?? "";
		expect(blockTag).not.toBe("");
		const block304 = await revalidate(`/v1/proofs/block/${ID}`, blockTag);
		expect(block304.status).toBe(304);
		expect(seen.filter((s) => s.startsWith("node /v3/blocks/"))).toHaveLength(
			1,
		);
	});

	test("tip-relative routes have no ETag", async () => {
		const res = await get("/v1/proofs/block/height/1");
		expect(res.status).toBe(200);
		expect(res.headers.get("etag")).toBeNull();
	});

	test("witness has its own lower per-account bucket; other routes keep theirs", async () => {
		const { limit } = PROOFS_RATE_LIMITS.account.witness;
		for (let i = 0; i < limit; i++) {
			const res = await get(`/v1/proofs/witness/${ID}`, FREE_KEY);
			expect(res.status).toBe(200);
			expect(res.headers.get("x-ratelimit-limit")).toBe(String(limit));
		}
		const limited = await get(`/v1/proofs/witness/${ID}`, FREE_KEY);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(seen.filter((s) => s.startsWith("sidecar /witness"))).toHaveLength(
			limit,
		);

		const burn = await get(`/v1/proofs/burn/${CH}`, FREE_KEY);
		expect(burn.status).toBe(200);
		expect(burn.headers.get("x-ratelimit-limit")).toBe(
			String(PROOFS_RATE_LIMITS.account.default.limit),
		);
	});

	test("the default bucket 429s past its limit", async () => {
		const { limit } = PROOFS_RATE_LIMITS.account.default;
		for (let i = 0; i < limit; i++) {
			expect((await get(`/v1/proofs/block/${ID}`, FREE_KEY)).status).toBe(200);
		}
		expect((await get(`/v1/proofs/block/${ID}`, FREE_KEY)).status).toBe(429);
	});

	test("first-party internal keys are not throttled", async () => {
		const { limit } = PROOFS_RATE_LIMITS.account.witness;
		for (let i = 0; i <= limit; i++) {
			const res = await get(`/v1/proofs/witness/${ID}`, INTERNAL_KEY);
			expect(res.status).toBe(200);
		}
	});
});

describe("proofs mounted on the app", () => {
	afterEach(() => {
		delete process.env.PROOF_SIDECAR_URL;
	});

	test("an instance without PROOF_SIDECAR_URL answers 503, not 404", async () => {
		delete process.env.PROOF_SIDECAR_URL;
		const res = await createApiApp("oss").request(`/v1/proofs/witness/${ID}`);
		expect(res.status).toBe(503);
		expect(((await res.json()) as { error: string }).error).toContain(
			"proofs unavailable on this instance",
		);
	});

	test("PROOF_SIDECAR_URL is read at request time", async () => {
		process.env.PROOF_SIDECAR_URL = SIDECAR_URL;
		const res = await createApiApp("oss").request(`/v1/proofs/burn/${CH}`);
		expect(res.status).toBe(200);
	});
});

describe("state writes for naming a block's diff", () => {
	const WRITES = [
		{
			ordinal: 0,
			tx_index: null,
			key: "__MARF_BLOCK_HEIGHT_SELF",
			value_hex: "00",
		},
		{ ordinal: 1, tx_index: 0, key: "vm::SP.store::1::k", value_hex: "3031" },
	];
	const reads: number[] = [];
	const readBlockWrites = async (height: number) => {
		reads.push(height);
		return height === 9137005 ? WRITES : [];
	};

	beforeEach(() => {
		reads.length = 0;
	});

	test("serves the whole block's writes in ordinal order, short-cached", async () => {
		const res = await get("/v1/proofs/writes/9137005", undefined, {
			readBlockWrites,
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			block_height: 9137005,
			state_writes: WRITES,
		});
		expect(res.headers.get("cache-control")).toBe(MUTABLE_CACHE_CONTROL);
		expect(reads).toEqual([9137005]);
	});

	test("a block this node has no writes for is a 404, so a verifier degrades to unnamed", async () => {
		const res = await get("/v1/proofs/writes/9137006", undefined, {
			readBlockWrites,
		});
		expect(res.status).toBe(404);
		expect(((await res.json()) as { code: string }).code).toBe("NOT_FOUND");
	});

	test("a malformed height never reaches the database", async () => {
		for (const path of ["/v1/proofs/writes/12a", "/v1/proofs/writes/1?x=1"]) {
			const res = await get(path, undefined, { readBlockWrites });
			expect(res.status).toBe(400);
		}
		expect(reads).toEqual([]);
	});

	test("hosted reads take the default proofs bucket", async () => {
		process.env.INSTANCE_MODE = "platform";
		const { limit } = PROOFS_RATE_LIMITS.account.default;
		for (let i = 0; i < limit; i++) {
			const res = await get("/v1/proofs/writes/9137005", FREE_KEY, {
				readBlockWrites,
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("x-ratelimit-limit")).toBe(String(limit));
		}
		const limited = await get("/v1/proofs/writes/9137005", FREE_KEY, {
			readBlockWrites,
		});
		expect(limited.status).toBe(429);
	});
});
