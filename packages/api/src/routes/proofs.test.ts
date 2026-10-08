import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
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

const ID = "ab".repeat(32);
const CH = "cd".repeat(20);
const MARF_PATH = "ef".repeat(32);
const WITNESS = new Uint8Array([0x03, 0x00, 0xff, 0x10, 0x20]);
const BLOCK = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

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
		if (url.pathname.startsWith("/v2/clarity/marf/")) {
			return Response.json({ data: "0x0100", proof: "0x00ff" });
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

function get(path: string, key?: string, opts?: Partial<ProofsRouterOptions>) {
	return app(opts).request(
		path,
		key ? { headers: { authorization: `Bearer ${key}` } } : undefined,
	);
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

	test("marf asks the node for a proof pinned to the tip", async () => {
		const res = await get(`/v1/proofs/marf/0x${MARF_PATH}?tip=0x${ID}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ data: "0x0100", proof: "0x00ff" });
		expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(seen).toEqual([
			`node /v2/clarity/marf/${MARF_PATH}?tip=${ID}&proof=1`,
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

describe("proofs on the hosted archive", () => {
	beforeEach(() => {
		process.env.INSTANCE_MODE = "platform";
	});

	test("an account key is required", async () => {
		expect((await get(`/v1/proofs/block/${ID}`)).status).toBe(401);
		expect(
			(await get(`/v1/proofs/block/${ID}`, "sk-sl_not_a_key")).status,
		).toBe(401);
		expect((await get(`/v1/proofs/block/${ID}`, FREE_KEY)).status).toBe(200);
		expect(seen).toEqual([`node /v3/blocks/${ID}`]);
	});

	test("witness has its own lower per-account bucket; other routes keep theirs", async () => {
		const { limit } = PROOFS_RATE_LIMITS.witness;
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
			String(PROOFS_RATE_LIMITS.default.limit),
		);
	});

	test("the default bucket 429s past its limit", async () => {
		const { limit } = PROOFS_RATE_LIMITS.default;
		for (let i = 0; i < limit; i++) {
			expect((await get(`/v1/proofs/block/${ID}`, FREE_KEY)).status).toBe(200);
		}
		expect((await get(`/v1/proofs/block/${ID}`, FREE_KEY)).status).toBe(429);
	});

	test("first-party internal keys are not throttled", async () => {
		const { limit } = PROOFS_RATE_LIMITS.witness;
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
