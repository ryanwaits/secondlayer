import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	RANGE_DIGEST_SPEC,
	type RangeDigest,
} from "@secondlayer/shared/archive/range-digest";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import { Hono } from "hono";
import { createApiApp } from "../create-app.ts";
import {
	INDEX_READ_SCOPE,
	type IndexEnv,
	type IndexTokenStore,
} from "../index/auth.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	DELETED_ROUTE_FIXTURES,
	RETAINED_ROUTE_FIXTURES,
} from "../route-manifest.ts";
import {
	ARCHIVE_VERIFY_RATE_LIMITS,
	type ArchiveVerifyRouterOptions,
	MAX_HEIGHTS_PER_REQUEST,
	MAX_RANGES_PER_REQUEST,
	createArchiveVerifyRouter,
} from "./archive-verify.ts";
import { OPENAPI_SPEC, openapiSpec } from "./openapi.ts";

const AGAINST = "https://archive.test/snapshots/deadbeef.json";

function signingKeys() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
	};
}

function digest(from = 0, to = 49_999, hash = "abc123"): RangeDigest {
	return {
		dataset: "blocks",
		from_block: from,
		to_block: to,
		row_count: 10,
		digest: hash,
		digest_spec: RANGE_DIGEST_SPEC,
	};
}

function fetchManifest(
	manifest: unknown,
): ArchiveVerifyRouterOptions["fetchImpl"] {
	return async () =>
		new Response(JSON.stringify(manifest), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
}

function buildApp(opts: ArchiveVerifyRouterOptions = {}): Hono<IndexEnv> {
	const app = new Hono<IndexEnv>();
	app.onError(errorHandler);
	app.route("/v1/archive", createArchiveVerifyRouter(opts));
	return app;
}

async function post(
	app: Hono<IndexEnv>,
	body: unknown,
	raw?: string,
	headers: Record<string, string> = {},
): Promise<Response> {
	return await app.request("/v1/archive/verify", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: raw ?? JSON.stringify(body),
	});
}

const noDb: ArchiveVerifyRouterOptions["getSourceDb"] = () => {
	throw new Error("SOURCE db should not be consulted");
};

describe("POST /v1/archive/verify", () => {
	test("malformed body → 400", async () => {
		const app = buildApp({ getSourceDb: noDb });
		const empty = await post(app, {});
		expect(empty.status).toBe(400);
		const invalid = await post(app, null, "{");
		expect(invalid.status).toBe(400);
	});

	test("local filesystem against → 400", async () => {
		const app = buildApp({ getSourceDb: noDb });
		const res = await post(app, { against: "/tmp/foo.json" });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/https/);
	});

	test("unsigned manifest, insecure omitted → 200 unanchored", async () => {
		const app = buildApp({
			getSourceDb: noDb,
			fetchImpl: fetchManifest({
				coverage: { from_block: 0, to_block: 49_999 },
				range_digests: [digest()],
			}),
		});
		const res = await post(app, { against: AGAINST });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			signature: { verified: boolean };
		};
		expect(body.status).toBe("unanchored");
		expect(body.signature.verified).toBe(false);
	});

	test("signed matching digests → 200 clean", async () => {
		const keys = signingKeys();
		const expected = digest();
		const signed = signStreamsBulkManifest(
			{
				coverage: { from_block: 0, to_block: 49_999 },
				range_digests: [expected],
			},
			keys.privatePem,
		);
		const app = buildApp({
			getSourceDb: () => ({}) as never,
			fetchImpl: fetchManifest(signed),
			computeRangeDigest: async (_db, dataset, fromBlock, toBlock) => ({
				...expected,
				dataset,
				from_block: fromBlock,
				to_block: toBlock,
			}),
		});
		const res = await post(app, {
			against: AGAINST,
			public_key_pem: keys.publicPem,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			signature: { verified: boolean };
			ranges: Array<{ status: string }>;
		};
		expect(body.signature.verified).toBe(true);
		expect(body.status).toBe("clean");
		expect(body.ranges.every((r) => r.status === "match")).toBe(true);
	});

	test("more than 40 ranges, no window → 400", async () => {
		const ranges = Array.from({ length: MAX_RANGES_PER_REQUEST + 1 }, (_, i) =>
			digest(i * 50_000, i * 50_000 + 49_999, `d${i}`),
		);
		const app = buildApp({
			getSourceDb: noDb,
			fetchImpl: fetchManifest({
				coverage: { from_block: 0, to_block: ranges.at(-1)?.to_block },
				range_digests: ranges,
			}),
		});
		const res = await post(app, { against: AGAINST, insecure: true });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/from_block/);
		expect(body.error).toMatch(/to_block/);
	});

	test("more than 40 ranges inside a window → 400", async () => {
		const ranges = Array.from({ length: MAX_RANGES_PER_REQUEST + 1 }, (_, i) =>
			digest(i * 50_000, i * 50_000 + 49_999, `d${i}`),
		);
		const app = buildApp({
			getSourceDb: noDb,
			fetchImpl: fetchManifest({ range_digests: ranges }),
		});
		const res = await post(app, {
			against: AGAINST,
			insecure: true,
			from_block: 0,
			to_block: 41 * 50_000,
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("Too many ranges in this window");
	});

	test("a range wider than the height budget → 400", async () => {
		const app = buildApp({
			getSourceDb: noDb,
			fetchImpl: fetchManifest({
				range_digests: [digest(0, MAX_HEIGHTS_PER_REQUEST, "wide")],
			}),
		});
		const res = await post(app, {
			against: AGAINST,
			insecure: true,
			from_block: 0,
			to_block: MAX_HEIGHTS_PER_REQUEST,
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("Too many heights in one request");
	});

	test("insecure: true on unsigned still compares", async () => {
		const expected = digest();
		const app = buildApp({
			getSourceDb: () => ({}) as never,
			fetchImpl: fetchManifest({
				coverage: { from_block: 0, to_block: 49_999 },
				range_digests: [expected],
			}),
			computeRangeDigest: async (_db, dataset, fromBlock, toBlock) => ({
				...expected,
				dataset,
				from_block: fromBlock,
				to_block: toBlock,
			}),
		});
		const res = await post(app, { against: AGAINST, insecure: true });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			signature: { verified: boolean };
		};
		expect(body.status).not.toBe("unanchored");
		expect(body.status).toBe("clean");
		expect(body.signature.verified).toBe(false);
	});
});

describe("POST /v1/archive/verify fixtures", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "oss";
	});

	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("OSS returns not-404", async () => {
		const app = createApiApp("oss");
		const res = await app.request("/v1/archive/verify", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect([200, 400]).toContain(res.status);
		expect(res.status).not.toBe(404);
	});

	test("path is retained, not deleted", () => {
		expect(
			RETAINED_ROUTE_FIXTURES.some(
				(r) => r.method === "POST" && r.path === "/v1/archive/verify",
			),
		).toBe(true);
		expect(DELETED_ROUTE_FIXTURES.map((r) => r.path as string)).not.toContain(
			"/v1/archive/verify",
		);
	});

	test("OpenAPI documents the route on the self-host spec", () => {
		expect(OPENAPI_SPEC.paths["/v1/archive/verify"]).toBeDefined();
		const oss = openapiSpec("oss") as unknown as {
			paths: Record<string, unknown>;
		};
		expect(oss.paths["/v1/archive/verify"]).toBeDefined();
	});
});

describe("POST /v1/archive/verify hosted", () => {
	const HOSTED_AGAINST =
		"https://archive.secondlayer.tools/streams/latest.json";
	const KEY = "sk-sl_archive_verify_fixture";
	const AUTH = { authorization: `Bearer ${KEY}` };
	const tokensFor = (tenantId: string): IndexTokenStore =>
		new Map([
			[
				KEY,
				{
					tenant_id: tenantId,
					account_id: tenantId,
					tier: "free",
					scopes: [INDEX_READ_SCOPE],
				},
			],
		]);
	const tokens = tokensFor("account:archive-verify-fixture");
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});

	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("no key → 401", async () => {
		const app = buildApp({ tokens, getSourceDb: noDb });
		const res = await post(app, { against: HOSTED_AGAINST });
		expect(res.status).toBe(401);
	});

	test("insecure → 400", async () => {
		const app = buildApp({ tokens, getSourceDb: noDb });
		const res = await post(
			app,
			{ against: HOSTED_AGAINST, insecure: true },
			undefined,
			AUTH,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("insecure is not accepted");
	});

	test("public_key_pem → 400", async () => {
		const app = buildApp({ tokens, getSourceDb: noDb });
		const res = await post(
			app,
			{ against: HOSTED_AGAINST, public_key_pem: signingKeys().publicPem },
			undefined,
			AUTH,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("public_key_pem is not accepted");
	});

	test("against off the archive host → 400", async () => {
		const app = buildApp({ tokens, getSourceDb: noDb });
		const res = await post(app, { against: AGAINST }, undefined, AUTH);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain(
			"against must be on archive.secondlayer.tools",
		);
	});

	test("fetch failure text is generic", async () => {
		const app = buildApp({
			tokens,
			getSourceDb: noDb,
			resolvePublicKey: async () => signingKeys().publicPem,
			fetchImpl: async () => {
				throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
			},
		});
		const res = await post(app, { against: HOSTED_AGAINST }, undefined, AUTH);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; reason: string };
		expect(body.status).toBe("unanchored");
		expect(body.reason).toBe("could not fetch or read the manifest");
		expect(JSON.stringify(body)).not.toContain("10.0.0.5");
	});

	test("request past the per-minute limit → 429", async () => {
		const app = buildApp({
			tokens: tokensFor("account:archive-verify-limited"),
			getSourceDb: noDb,
			resolvePublicKey: async () => signingKeys().publicPem,
			fetchImpl: async () => {
				throw new Error("down");
			},
		});
		for (let i = 0; i < ARCHIVE_VERIFY_RATE_LIMITS.account.limit; i++) {
			const ok = await post(app, { against: HOSTED_AGAINST }, undefined, AUTH);
			expect(ok.status).toBe(200);
		}
		const res = await post(app, { against: HOSTED_AGAINST }, undefined, AUTH);
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).not.toBeNull();
	});
});

describe("POST /v1/archive/verify self-host fetch errors", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "oss";
	});

	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("OSS: fetch failure text stays detailed", async () => {
		const app = buildApp({
			getSourceDb: noDb,
			resolvePublicKey: async () => signingKeys().publicPem,
			fetchImpl: async () => {
				throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
			},
		});
		const res = await post(app, { against: AGAINST });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { reason: string };
		expect(body.reason).toContain("ECONNREFUSED");
	});
});
