import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { sql } from "kysely";
import { hashToken } from "../auth/keys.ts";
import { createApiApp } from "../create-app.ts";
import { PLAY_MAX_CONCURRENT_PER_IP } from "./sybil.ts";
import { CLAIM_TOKEN_TTL_MS, createClaimToken } from "./tokens.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const seededAccountIds: string[] = [];
const seededNames: string[] = [];
const seededIpHashes: string[] = [];

function deployBody(name: string) {
	const schema = { rows: { columns: { amount: { type: "uint" } } } };
	const source = {
		type: "print_event",
		contractId: "SP123.play-deploy",
		topic: "tick",
		prints: { tick: { amount: "uint" } },
	};
	const handlerCode = [
		"function defineSubgraph(def) { return def; }",
		"export default defineSubgraph({",
		`  name: ${JSON.stringify(name)},`,
		`  sources: { prints: ${JSON.stringify(source)} },`,
		`  schema: ${JSON.stringify(schema)},`,
		"  handlers: {",
		"    prints: async (event, ctx) => {",
		"      ctx.insert('rows', { amount: event.data?.amount ?? 0n });",
		"    },",
		"  },",
		"});",
	].join("\n");
	return {
		name,
		sources: { prints: source },
		schema,
		handlerCode,
		startBlock: 1,
	};
}

function restoreEnv(key: string, prev: string | undefined): void {
	if (prev === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = prev;
}

describe("POST /v1/play OSS", () => {
	test("404 when unmounted", async () => {
		const prev = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "oss";
		try {
			const app = createApiApp("oss");
			const res = await app.request("/v1/play", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ subgraph: deployBody("play-oss") }),
			});
			expect(res.status).toBe(404);
			const body = (await res.json()) as { code: string };
			expect(body.code).toBe("NOT_FOUND");
		} finally {
			restoreEnv("INSTANCE_MODE", prev);
		}
	});
});

describe.skipIf(!HAS_DB)("POST /v1/play platform", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});

	afterEach(() => {
		restoreEnv("INSTANCE_MODE", prevMode);
	});

	afterAll(async () => {
		if (!HAS_DB) return;
		if (seededNames.length > 0) {
			const rows = await db
				.selectFrom("subgraphs")
				.select(["schema_name", "name"])
				.where("name", "in", seededNames)
				.execute();
			await db
				.deleteFrom("subgraph_operations")
				.where("subgraph_name", "in", seededNames)
				.execute();
			await db
				.deleteFrom("subgraphs")
				.where("name", "in", seededNames)
				.execute();
			for (const row of rows) {
				if (row.schema_name) {
					await sql`DROP SCHEMA IF EXISTS ${sql.id(row.schema_name)} CASCADE`.execute(
						db,
					);
				}
			}
		}
		if (seededAccountIds.length > 0) {
			await db
				.deleteFrom("account_credits")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("subscriptions")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("api_keys")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("claim_tokens")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("accounts")
				.where("id", "in", seededAccountIds)
				.execute();
		}
		if (seededIpHashes.length > 0) {
			await db
				.deleteFrom("play_provisions")
				.where("ip_hash", "in", seededIpHashes)
				.execute();
		}
	});

	test("provisions a ghost, key, claim url, and expiry", async () => {
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
		seededIpHashes.push(hashToken(ip));
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify({ subgraph: deployBody(name) }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			key: string;
			claim_url: string;
			claim_expires_at: string;
			subgraph: { name: string; expires_at: string };
		};
		expect(body.key.startsWith("sk-sl_")).toBe(true);
		expect(body.claim_url).toContain("/claim/");
		expect(body.subgraph.name).toBe(name);
		expect(Date.parse(body.subgraph.expires_at)).toBeGreaterThan(Date.now());
		expect(Date.parse(body.claim_expires_at)).toBeGreaterThan(Date.now());

		const keyRow = await db
			.selectFrom("api_keys")
			.select("account_id")
			.where("key_hash", "=", hashToken(body.key))
			.executeTakeFirstOrThrow();
		seededAccountIds.push(keyRow.account_id);
		const account = await db
			.selectFrom("accounts")
			.select(["ghost", "email"])
			.where("id", "=", keyRow.account_id)
			.executeTakeFirstOrThrow();
		expect(account.ghost).toBe(true);
		expect(account.email).toBeNull();
		expect(await getCredits(db, keyRow.account_id)).toBe(10_000_000n);
		const sg = await db
			.selectFrom("subgraphs")
			.select("expires_at")
			.where("name", "=", name)
			.where("account_id", "=", keyRow.account_id)
			.executeTakeFirstOrThrow();
		expect(sg.expires_at).not.toBeNull();
	}, 30_000);

	test("rejects a fourth provision from the same IP", async () => {
		const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
		const ipHash = hashToken(ip);
		seededIpHashes.push(ipHash);
		await db
			.insertInto("play_provisions")
			.values({
				ip_hash: ipHash,
				day: new Date().toISOString().slice(0, 10),
				count: 3,
			})
			.execute();
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify({
				subgraph: deployBody(`play-${crypto.randomUUID().slice(0, 8)}`),
			}),
		});
		expect(res.status).toBe(429);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("RATE_LIMITED");
	});

	test("rolls back ghost and subgraph when subscription is invalid", async () => {
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
		seededIpHashes.push(hashToken(ip));
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify({
				subgraph: deployBody(name),
				subscription: {
					name: "play-hook",
					url: "https://example.com/hook",
					subgraphName: "does-not-exist",
					tableName: "rows",
				},
			}),
		});
		expect(res.status).toBe(400);
		const leftover = await db
			.selectFrom("subgraphs")
			.select("id")
			.where("name", "=", name)
			.executeTakeFirst();
		expect(leftover).toBeUndefined();
	}, 30_000);

	test("GET /v1/play with play key is 200; claimed key is 404", async () => {
		const ghost = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		seededAccountIds.push(ghost.id);
		const dest = await db
			.insertInto("accounts")
			.values({
				email: `claimed-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
				ghost: false,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		seededAccountIds.push(dest.id);

		const playRaw = `sk-sl_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
		const claimedRaw = `sk-sl_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(playRaw),
				key_prefix: "sk-sl_play",
				account_id: ghost.id,
				ip_address: "test",
				product: "account",
				tier: "free",
				status: "active",
				name: "play",
			})
			.execute();
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(claimedRaw),
				key_prefix: "sk-sl_clmd",
				account_id: dest.id,
				ip_address: "test",
				product: "account",
				tier: "free",
				status: "active",
			})
			.execute();
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		await db
			.insertInto("subgraphs")
			.values({
				name,
				status: "active",
				definition: {},
				schema_hash: "test",
				handler_path: "test",
				schema_name: `subgraph_play_${crypto.randomUUID().slice(0, 8)}`,
				account_id: ghost.id,
				last_processed_block: 0,
				database_url_enc: null,
				expires_at: new Date(Date.now() + CLAIM_TOKEN_TTL_MS),
			})
			.execute();
		const claim = await createClaimToken(db, ghost.id);

		const app = createApiApp("platform");
		const ok = await app.request("/v1/play", {
			headers: { authorization: `Bearer ${playRaw}` },
		});
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as {
			subgraphs: Array<{ name: string; expires_at: string | null }>;
			claim_expires_at: string | null;
		};
		expect(body.subgraphs.map((s) => s.name)).toContain(name);
		expect(body.claim_expires_at).toBe(claim.expiresAt.toISOString());

		const claimed = await app.request("/v1/play", {
			headers: { authorization: `Bearer ${claimedRaw}` },
		});
		expect(claimed.status).toBe(404);
	});

	async function seedPlayGhost(opts: {
		ip: string;
		expiresAt: Date | null;
		ghost?: boolean;
	}): Promise<{ accountId: string; name: string }> {
		const account = await db
			.insertInto("accounts")
			.values({
				email:
					opts.ghost === false
						? `claimed-${crypto.randomUUID().slice(0, 8)}@test.invalid`
						: null,
				ghost: opts.ghost ?? true,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		seededAccountIds.push(account.id);
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		await db
			.insertInto("subgraphs")
			.values({
				name,
				status: "active",
				definition: {},
				schema_hash: "test",
				handler_path: "test",
				schema_name: `subgraph_play_${crypto.randomUUID().slice(0, 8)}`,
				account_id: account.id,
				last_processed_block: 0,
				database_url_enc: null,
				expires_at: opts.expiresAt,
			})
			.execute();
		const playRaw = `sk-sl_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(playRaw),
				key_prefix: "sk-sl_play",
				account_id: account.id,
				ip_address: opts.ip,
				product: "account",
				tier: "free",
				status: "active",
				name: "play",
			})
			.execute();
		return { accountId: account.id, name };
	}

	async function trackProvisioned(res: Response, ip: string): Promise<void> {
		seededIpHashes.push(hashToken(ip));
		if (res.status !== 201) return;
		const body = (await res.clone().json()) as { key: string };
		const keyRow = await db
			.selectFrom("api_keys")
			.select("account_id")
			.where("key_hash", "=", hashToken(body.key))
			.executeTakeFirst();
		if (keyRow) seededAccountIds.push(keyRow.account_id);
	}

	test("rejects a fourth concurrent play subgraph from the same IP", async () => {
		const ip = "203.0.113.10";
		const future = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
		for (let i = 0; i < PLAY_MAX_CONCURRENT_PER_IP; i++) {
			await seedPlayGhost({ ip, expiresAt: future });
		}
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify({ subgraph: deployBody(name) }),
		});
		await trackProvisioned(res, ip);
		expect(res.status).toBe(429);
		const body = (await res.json()) as { code: string; limit: number };
		expect(body.code).toBe("PLAY_CONCURRENCY");
		expect(body.limit).toBe(PLAY_MAX_CONCURRENT_PER_IP);
	});

	test("other IP can still provision while one IP is at the concurrent cap", async () => {
		const blocked = "203.0.113.10";
		const other = "203.0.113.11";
		const future = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
		for (let i = 0; i < PLAY_MAX_CONCURRENT_PER_IP; i++) {
			await seedPlayGhost({ ip: blocked, expiresAt: future });
		}
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": other,
			},
			body: JSON.stringify({ subgraph: deployBody(name) }),
		});
		await trackProvisioned(res, other);
		expect(res.status).toBe(201);
	}, 30_000);

	test("claiming a slot lets the original IP provision again", async () => {
		const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
		const future = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
		const seeded: Array<{ accountId: string; name: string }> = [];
		for (let i = 0; i < PLAY_MAX_CONCURRENT_PER_IP; i++) {
			seeded.push(await seedPlayGhost({ ip, expiresAt: future }));
		}
		const slot = seeded[0];
		if (!slot) throw new Error("expected seeded play subgraph");
		await db
			.updateTable("accounts")
			.set({ ghost: false })
			.where("id", "=", slot.accountId)
			.execute();
		await db
			.updateTable("subgraphs")
			.set({ expires_at: null })
			.where("account_id", "=", slot.accountId)
			.execute();
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify({ subgraph: deployBody(name) }),
		});
		await trackProvisioned(res, ip);
		expect(res.status).toBe(201);
	}, 30_000);

	test("rejects provision without X-Forwarded-For", async () => {
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ subgraph: deployBody(name) }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("PLAY_IP_UNKNOWN");
	});

	test("expired play subgraphs do not count toward the concurrent cap", async () => {
		const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
		const past = new Date(Date.now() - 60_000);
		for (let i = 0; i < PLAY_MAX_CONCURRENT_PER_IP; i++) {
			await seedPlayGhost({ ip, expiresAt: past });
		}
		const name = `play-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		const app = createApiApp("platform");
		const res = await app.request("/v1/play", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify({ subgraph: deployBody(name) }),
		});
		await trackProvisioned(res, ip);
		expect(res.status).toBe(201);
	}, 30_000);
});
