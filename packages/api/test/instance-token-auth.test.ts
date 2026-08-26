import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { defaultInternalStreamsApiKey } from "@secondlayer/shared/index-internal-auth";
import type { Hono } from "hono";
import { createApiApp } from "../src/create-app.ts";

/**
 * The documented self-host auth model, end to end through the real app.
 *
 * One credential (`INSTANCE_TOKEN`), no accounts, no minted product keys.
 * Loopback reads are open on every `/v1` sub-plane; a bind past loopback needs
 * the token on every request; writes need it whenever it is set.
 *
 * Assertions are about *auth*, so they check "not 401" rather than 200 — the
 * handlers behind them read Postgres and may fail for unrelated reasons.
 */

const TOKEN = "b7f4c2a19d8e6035f1a2c4b6d8e0f2a4";

const READ_PLANES = [
	"/v1/index/events?limit=1",
	"/v1/streams/tip",
	"/v1/subgraphs",
] as const;

const prev = {
	mode: process.env.INSTANCE_MODE,
	host: process.env.LISTEN_HOST,
	publish: process.env.API_PUBLISH_ADDR,
	token: process.env.INSTANCE_TOKEN,
	apiKey: process.env.API_KEY,
};

function restore(key: string, value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = value;
}

afterAll(() => {
	restore("INSTANCE_MODE", prev.mode);
	restore("LISTEN_HOST", prev.host);
	restore("API_PUBLISH_ADDR", prev.publish);
	restore("INSTANCE_TOKEN", prev.token);
	restore("API_KEY", prev.apiKey);
});

function ossApp(listenHost: string, publishAddr?: string): Hono {
	process.env.INSTANCE_MODE = "oss";
	process.env.LISTEN_HOST = listenHost;
	if (publishAddr === undefined)
		Reflect.deleteProperty(process.env, "API_PUBLISH_ADDR");
	else process.env.API_PUBLISH_ADDR = publishAddr;
	process.env.INSTANCE_TOKEN = TOKEN;
	Reflect.deleteProperty(process.env, "API_KEY");
	return createApiApp("oss");
}

function bearer(token: string): { headers: Record<string, string> } {
	return { headers: { authorization: `Bearer ${token}` } };
}

describe("self-host auth model", () => {
	beforeEach(() => {
		process.env.INSTANCE_MODE = "oss";
	});

	describe("loopback bind", () => {
		// The product decision this pins: a loopback instance keeps keyless
		// reads even though `secondlayer init` always mints a token. Setting a
		// token locks down writes and any future public bind — it does not
		// take `curl 127.0.0.1:3800/v1/index/events` away from the operator.
		test("every /v1 read plane serves anonymous GETs with a token set", async () => {
			const app = ossApp("127.0.0.1");
			expect(process.env.INSTANCE_TOKEN).toBe(TOKEN);
			for (const path of READ_PLANES) {
				const res = await app.request(path);
				expect(res.status, path).not.toBe(401);
			}
		});

		test("every /v1 read plane serves anonymous GETs with no token at all", async () => {
			process.env.INSTANCE_MODE = "oss";
			process.env.LISTEN_HOST = "127.0.0.1";
			Reflect.deleteProperty(process.env, "INSTANCE_TOKEN");
			Reflect.deleteProperty(process.env, "API_KEY");
			const app = createApiApp("oss");
			for (const path of READ_PLANES) {
				const res = await app.request(path);
				expect(res.status, path).not.toBe(401);
			}
		});

		test("the instance token is accepted on every /v1 read plane", async () => {
			const app = ossApp("127.0.0.1");
			for (const path of READ_PLANES) {
				const res = await app.request(path, bearer(TOKEN));
				expect(res.status, path).not.toBe(401);
			}
		});

		test("an unrecognized token does not turn a working read into a 401", async () => {
			const app = ossApp("127.0.0.1");
			for (const path of READ_PLANES) {
				const anon = await app.request(path);
				const keyed = await app.request(path, bearer("sk-sl_not_a_real_key"));
				expect(keyed.status, path).toBe(anon.status);
			}
		});

		test("the instance token opens the write plane, and nothing else does", async () => {
			const app = ossApp("127.0.0.1");
			expect((await app.request("/api/subgraphs")).status).toBe(401);
			expect(
				(await app.request("/api/subgraphs", bearer("sk-sl_wrong"))).status,
			).toBe(401);
			expect(
				(await app.request("/api/subgraphs", bearer(TOKEN))).status,
			).not.toBe(401);
		});

		test("a 401 names the credential and where it comes from", async () => {
			const app = ossApp("127.0.0.1");
			const res = await app.request("/api/subgraphs");
			expect(res.status).toBe(401);
			const body = (await res.json()) as {
				details?: { env_var?: string; hint?: string };
			};
			expect(body.details?.env_var).toBe("INSTANCE_TOKEN");
			expect(body.details?.hint).toContain("secondlayer init");
			expect(body.details?.hint).toContain("loopback");
		});
	});

	describe("bind past loopback", () => {
		test("every /v1 read plane demands a credential", async () => {
			const app = ossApp("0.0.0.0");
			for (const path of [...READ_PLANES, "/v1/contracts?trait=sip-010"]) {
				const res = await app.request(path);
				expect(res.status, path).toBe(401);
			}
		});

		test("the instance token is accepted on every /v1 read plane", async () => {
			const app = ossApp("0.0.0.0");
			for (const path of [...READ_PLANES, "/v1/contracts?trait=sip-010"]) {
				const res = await app.request(path, bearer(TOKEN));
				expect(res.status, path).not.toBe(401);
			}
		});

		test("an unrecognized token is rejected", async () => {
			const app = ossApp("0.0.0.0");
			for (const path of READ_PLANES) {
				const res = await app.request(path, bearer("sk-sl_not_a_real_key"));
				expect(res.status, path).toBe(401);
			}
		});

		test("health stays open so the container probe keeps working", async () => {
			const app = ossApp("0.0.0.0");
			expect((await app.request("/health")).status).not.toBe(401);
		});
	});

	// What `docker compose up` produces out of the box: the container binds
	// 0.0.0.0 because it must, and publishes to 127.0.0.1 because that is the
	// default. The docs' keyless `curl http://127.0.0.1:3800/v1/index/events`
	// has to work against exactly this env.
	describe("default containerized install", () => {
		test("every /v1 read plane serves anonymous GETs", async () => {
			const app = ossApp("0.0.0.0", "127.0.0.1:3800");
			for (const path of READ_PLANES) {
				const res = await app.request(path);
				expect(res.status, path).not.toBe(401);
			}
		});

		test("publishing past loopback closes them again", async () => {
			const app = ossApp("0.0.0.0", "0.0.0.0:3800");
			for (const path of READ_PLANES) {
				expect((await app.request(path)).status, path).toBe(401);
				const keyed = await app.request(path, bearer(TOKEN));
				expect(keyed.status, path).not.toBe(401);
			}
		});

		test("a publish spec naming no host is treated as public", async () => {
			const app = ossApp("0.0.0.0", "3800");
			for (const path of READ_PLANES) {
				expect((await app.request(path)).status, path).toBe(401);
			}
		});

		test("writes still need the token on a loopback publish", async () => {
			const app = ossApp("0.0.0.0", "127.0.0.1:3800");
			expect((await app.request("/api/subgraphs")).status).toBe(401);
			expect(
				(await app.request("/api/subgraphs", bearer(TOKEN))).status,
			).not.toBe(401);
		});
	});

	test("the decoder credential still reads Streams", async () => {
		const prevInternal = process.env.STREAMS_INTERNAL_API_KEY;
		Reflect.deleteProperty(process.env, "STREAMS_INTERNAL_API_KEY");
		try {
			for (const host of ["127.0.0.1", "0.0.0.0"]) {
				const app = ossApp(host);
				const key = defaultInternalStreamsApiKey();
				expect(key).toBe(TOKEN);
				if (!key) throw new Error("expected INSTANCE_TOKEN");
				const res = await app.request("/v1/streams/tip", bearer(key));
				expect(res.status, host).not.toBe(401);
			}
		} finally {
			restore("STREAMS_INTERNAL_API_KEY", prevInternal);
		}
	});

	test("API_KEY is still honored as a legacy alias of INSTANCE_TOKEN", async () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "0.0.0.0";
		Reflect.deleteProperty(process.env, "INSTANCE_TOKEN");
		process.env.API_KEY = TOKEN;
		const app = createApiApp("oss");
		expect((await app.request("/v1/streams/tip")).status).toBe(401);
		expect(
			(await app.request("/v1/streams/tip", bearer(TOKEN))).status,
		).not.toBe(401);
	});
});
