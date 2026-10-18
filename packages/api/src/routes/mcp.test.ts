import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	type OAuthClientProvider,
	auth,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
	type OAuthClientInformationMixed,
	OAuthMetadataSchema,
	OAuthProtectedResourceMetadataSchema,
	type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
	approveOauthRequest,
	revokeOauthGrant,
} from "@secondlayer/platform/db/queries/oauth";
import { getDb } from "@secondlayer/shared/db";
import { hashToken } from "../auth/keys.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";

/**
 * The hosted MCP end to end through `createApiApp("platform")`: the 401
 * challenge, the MCP SDK's own OAuth client (discovery, DCR, authorize,
 * consent, token, refresh), tool calls dispatched in process and metered to
 * the account, and the audience rule (an app's token works on /mcp only).
 */

const ORIGIN = "https://api.mcp.test";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "http://127.0.0.1:53682/callback";

const HOSTED_TOOLS = [
	"account_whoami",
	"batch_query",
	"contracts_find",
	"contracts_get_abi",
	"index_blocks",
	"index_contract_calls",
	"index_discover",
	"index_events",
	"index_ft_transfers",
	"index_nft_transfers",
	"index_print_schema",
	"index_transactions",
	"streams_dumps",
	"streams_tip",
	"subgraphs_scaffold",
];

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const saved: Record<string, string | undefined> = {};
const accountIds: string[] = [];
let height = 0;

beforeAll(async () => {
	for (const k of ["INSTANCE_MODE", "DEV_MODE", "API_PUBLIC_URL"])
		saved[k] = process.env[k];
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
	process.env.API_PUBLIC_URL = ORIGIN;
	if (!HAS_DB) return;
	// One canonical block and transaction, so a read returns a row to meter.
	height = 9_600_000 + Math.floor(Math.random() * 100_000);
	await db
		.insertInto("blocks")
		.values({
			height,
			hash: `0xmcp${height}`,
			parent_hash: `0xmcp${height - 1}`,
			burn_block_height: 1,
			burn_block_hash: "0xb",
			timestamp: 1_700_000_000,
			canonical: true,
		})
		.execute();
	await db
		.insertInto("transactions")
		.values({
			tx_id: `0xmcp${height}`,
			block_height: height,
			tx_index: 0,
			type: "token_transfer",
			sender: "SP1",
			status: "success",
			contract_id: null,
			function_name: null,
			function_args: null,
			raw_result: null,
			raw_tx: "0x00",
		})
		.execute();
});

afterAll(async () => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
	if (!HAS_DB) return;
	await db
		.deleteFrom("transactions")
		.where("block_height", "=", height)
		.execute();
	await db.deleteFrom("blocks").where("height", "=", height).execute();
	if (accountIds.length === 0) return;
	await db
		.deleteFrom("usage_ledger")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("api_keys")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

beforeEach(async () => {
	await getRateLimitStore().clear();
});

const app = createApiApp("platform");
const fetchApp = (async (url: string | URL | Request, init?: RequestInit) =>
	app.fetch(
		url instanceof Request ? url : new Request(String(url), init),
	)) as typeof fetch;

async function account(): Promise<{ id: string; email: string; key: string }> {
	const email = `mcp-${crypto.randomUUID()}@example.com`;
	const row = await db
		.insertInto("accounts")
		.values({ email })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	const key = `sk-sl_mcp_${crypto.randomUUID()}`;
	await db
		.insertInto("api_keys")
		.values({
			key_hash: hashToken(key),
			key_prefix: key.slice(0, 14),
			account_id: row.id,
			ip_address: "test",
			product: "account",
			tier: "free",
			status: "active",
		})
		.execute();
	return { id: row.id, email, key };
}

let rid = 0;
const rpc = (
	token: string | null,
	method: string,
	params: unknown = {},
	extra: RequestInit = {},
) =>
	app.request("/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }),
		...extra,
	});
// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC bodies are asserted field by field
const result = async (res: Response): Promise<any> =>
	((await res.json()) as { result: unknown }).result;
const callTool = async (
	token: string,
	name: string,
	args: Record<string, unknown> = {},
) => result(await rpc(token, "tools/call", { name, arguments: args }));

const INIT = {
	protocolVersion: "2025-06-18",
	capabilities: {},
	clientInfo: { name: "t", version: "0" },
};

async function ledgerFor(accountId: string) {
	return db
		.selectFrom("usage_ledger")
		.select(["unit", "quantity", "source", "api_key_id"])
		.where("account_id", "=", accountId)
		.where("unit", "=", "rows.delivered")
		.execute();
}

/** The MCP SDK's own OAuth client; its "browser" approves as `accountId`. */
async function signIn(accountId: string) {
	const store: {
		info?: OAuthClientInformationMixed;
		tokens?: OAuthTokens;
		verifier?: string;
		code?: string;
	} = {};
	let seen: URL | undefined;
	const provider: OAuthClientProvider = {
		get redirectUrl() {
			return REDIRECT;
		},
		get clientMetadata() {
			return {
				client_name: "SDK test",
				redirect_uris: [REDIRECT],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			};
		},
		state: () => "sdk-state",
		clientInformation: () => store.info,
		saveClientInformation: (i) => {
			store.info = i;
		},
		tokens: () => store.tokens,
		saveTokens: (t) => {
			store.tokens = t;
		},
		saveCodeVerifier: (v) => {
			store.verifier = v;
		},
		codeVerifier: () => store.verifier ?? "",
		// The consent page: follow authorize, approve as the account, read the code.
		redirectToAuthorization: async (url) => {
			seen = url;
			const r = await fetchApp(url.toString());
			const req = new URL(r.headers.get("location") ?? "").searchParams.get(
				"req",
			);
			const ok = await approveOauthRequest(db, req ?? "", accountId);
			if (!ok) throw new Error("not approved");
			store.code = ok.code;
		},
	};
	expect(await auth(provider, { serverUrl: RESOURCE, fetchFn: fetchApp })).toBe(
		"REDIRECT",
	);
	expect(seen?.searchParams.get("resource")).toBe(RESOURCE);
	expect(seen?.searchParams.get("code_challenge_method")).toBe("S256");
	expect(
		await auth(provider, {
			serverUrl: RESOURCE,
			authorizationCode: store.code,
			fetchFn: fetchApp,
		}),
	).toBe("AUTHORIZED");
	return { provider, store };
}

describe("hosted MCP metadata", () => {
	test("the protected resource and authorization server metadata parse with the SDK's schemas", async () => {
		const pr = OAuthProtectedResourceMetadataSchema.parse(
			await (
				await app.request("/.well-known/oauth-protected-resource/mcp")
			).json(),
		);
		expect(pr.resource).toBe(RESOURCE);
		const as = OAuthMetadataSchema.parse(
			await (
				await app.request("/.well-known/oauth-authorization-server")
			).json(),
		);
		expect(as.issuer).toBe(ORIGIN);
		expect(as.code_challenge_methods_supported).toEqual(["S256"]);
	});

	test("no bearer: 401 naming the resource metadata", async () => {
		const r = await rpc(null, "initialize", INIT);
		expect(r.status).toBe(401);
		expect(r.headers.get("www-authenticate")).toBe(
			`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
		);
	});

	test("an unknown token, of any kind, is 401 invalid_token", async () => {
		for (const t of ["oat-sl_nope", "sk-sl_nope", "ss-sl_nope", "whatever"]) {
			const r = await rpc(t, "tools/list");
			expect(r.status, t).toBe(401);
			expect(r.headers.get("www-authenticate")).toContain(
				'error="invalid_token"',
			);
		}
	});

	test("GET and DELETE are 405; CORS allows any origin without credentials", async () => {
		for (const method of ["GET", "DELETE"]) {
			const r = await app.request("/mcp", { method });
			expect(r.status).toBe(405);
			expect(r.headers.get("allow")).toBe("POST");
		}
		const pre = await app.request("/mcp", {
			method: "OPTIONS",
			headers: {
				origin: "https://some.app",
				"access-control-request-method": "POST",
			},
		});
		expect(pre.status).toBe(204);
		expect(pre.headers.get("access-control-allow-origin")).toBe("*");
		expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
	});
});

describe.skipIf(!HAS_DB)("hosted MCP", () => {
	test("an sk-sl_ key works: initialize, then tools/list as a separate POST, no session", async () => {
		const me = await account();
		const init = await rpc(me.key, "initialize", INIT);
		expect(init.status).toBe(200);
		expect(init.headers.get("mcp-session-id")).toBeNull();
		expect((await result(init)).serverInfo.name).toBe("secondlayer");
		const list = await result(await rpc(me.key, "tools/list"));
		expect(list.tools.map((t: { name: string }) => t.name).sort()).toEqual(
			HOSTED_TOOLS,
		);
	});

	test("a body over 1 MB is 413", async () => {
		const me = await account();
		const r = await app.request("/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				authorization: `Bearer ${me.key}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
				params: { pad: "x".repeat(1024 * 1024) },
			}),
		});
		expect(r.status).toBe(413);
	});

	test("the MCP SDK's auth(): discovery, DCR, authorize, consent, token; then tools and refresh", async () => {
		const me = await account();
		const { provider, store } = await signIn(me.id);
		const access = store.tokens?.access_token ?? "";
		expect(access).toStartWith("oat-sl_");
		expect(store.tokens?.refresh_token).toStartWith("ort-sl_");

		const list = await result(await rpc(access, "tools/list"));
		expect(list.tools.map((t: { name: string }) => t.name).sort()).toEqual(
			HOSTED_TOOLS,
		);

		// An index read through the hosted MCP: served and metered to the
		// account, with no key id (it was an app's token).
		const before = (await ledgerFor(me.id)).length;
		const txs = await callTool(access, "index_transactions", {
			fromHeight: height,
			toHeight: height,
		});
		expect(txs.isError).toBeUndefined();
		const body = JSON.parse(txs.content[0].text) as {
			transactions: { tx_id: string }[];
		};
		expect(body.transactions.map((t) => t.tx_id)).toEqual([`0xmcp${height}`]);
		const ledger = await ledgerFor(me.id);
		expect(ledger.length).toBe(before + 1);
		expect(ledger.at(-1)).toMatchObject({
			unit: "rows.delivered",
			quantity: "1",
			source: "index",
			api_key_id: null,
		});

		// account_whoami reads /api/accounts/me in process with the same token.
		const who = await callTool(access, "account_whoami");
		expect(JSON.parse(who.content[0].text).email).toBe(me.email);

		// batch_query: its items are the MCP's own requests too.
		const batch = await callTool(access, "batch_query", {
			requests: [
				{
					path: "/v1/index/transactions",
					params: { from_height: String(height), to_height: String(height) },
				},
			],
		});
		const items = JSON.parse(batch.content[0].text) as {
			results: { status: number }[];
		};
		expect(items.results[0].status).toBe(200);

		// A refresh through the SDK rotates the refresh token.
		const old = store.tokens?.refresh_token;
		store.tokens = {
			...(store.tokens as OAuthTokens),
			access_token: "expired",
		};
		expect(
			await auth(provider, { serverUrl: RESOURCE, fetchFn: fetchApp }),
		).toBe("AUTHORIZED");
		expect(store.tokens?.refresh_token).not.toBe(old);
		expect(
			(await rpc(store.tokens?.access_token ?? "", "tools/list")).status,
		).toBe(200);
	});

	test("an app's token sent straight to /v1 or /api is 401, never a key or a session", async () => {
		const me = await account();
		const { store } = await signIn(me.id);
		const access = store.tokens?.access_token ?? "";
		for (const [method, path, body] of [
			["GET", `/v1/index/transactions?from_height=${height}`, undefined],
			["GET", "/v1/index/blocks", undefined],
			["GET", "/v1/streams/tip", undefined],
			["GET", "/v1/streams/events", undefined],
			["GET", "/api/accounts/me", undefined],
			["GET", "/api/billing/status", undefined],
			["GET", "/api/keys", undefined],
			["POST", "/api/keys", {}],
			["GET", "/api/oauth/grants", undefined],
		] as const) {
			const r = await app.request(path, {
				method,
				headers: {
					authorization: `Bearer ${access}`,
					...(body ? { "content-type": "application/json" } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			expect([401, 403], `${method} ${path} → ${r.status}`).toContain(r.status);
		}
		// A direct batch: each item is a fresh request, not the MCP's.
		const batch = await app.request("/v1/batch", {
			method: "POST",
			headers: {
				authorization: `Bearer ${access}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				requests: [{ path: "/v1/index/transactions" }],
			}),
		});
		const items = (await batch.json()) as { results?: { status: number }[] };
		expect(items.results?.[0]?.status ?? batch.status).toBe(401);
		// Nothing was read, so nothing was metered.
		expect(await ledgerFor(me.id)).toEqual([]);
	});

	test("a revoked grant gets 401 on /mcp at once", async () => {
		const me = await account();
		const { store } = await signIn(me.id);
		const access = store.tokens?.access_token ?? "";
		expect((await rpc(access, "tools/list")).status).toBe(200);
		const grant = await db
			.selectFrom("oauth_grants")
			.select("id")
			.where("account_id", "=", me.id)
			.executeTakeFirstOrThrow();
		expect(await revokeOauthGrant(db, grant.id, me.id)).toBe(true);
		const r = await rpc(access, "tools/list");
		expect(r.status).toBe(401);
		expect(r.headers.get("www-authenticate")).toContain(
			'error="invalid_token"',
		);
	});

	test("no hosted tool can reach key or grant management, even in process", async () => {
		const me = await account();
		const list = await result(await rpc(me.key, "tools/list"));
		const names = list.tools.map((t: { name: string }) => t.name);
		expect(names).not.toContain("account_create_key");
		for (const n of names) expect(n).not.toMatch(/key|grant/);
		// batch_query refuses anything outside the public read planes.
		const r = await callTool(me.key, "batch_query", {
			requests: [{ path: "/api/keys" }],
		});
		const out = JSON.parse(r.content[0].text) as {
			results?: { status: number }[];
		};
		expect(out.results?.[0]?.status ?? 400).toBe(400);
	});

	test("concurrent callers with different credentials never see each other's account", async () => {
		const [a, b] = [await account(), await account()];
		const rounds = await Promise.all(
			Array.from({ length: 6 }, (_, i) => {
				const who = i % 2 ? b : a;
				return callTool(who.key, "account_whoami").then((r) => ({
					who,
					email: JSON.parse(r.content[0].text).email as string,
				}));
			}),
		);
		for (const { who, email } of rounds) expect(email).toBe(who.email);
	});
});
