import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import { registerPaidWriteRoutes } from "../src/routes/v1-subgraphs.ts";
import { resolveWalletAccount } from "../src/subgraphs/wallet-account.ts";

const SKIP = !process.env.DATABASE_URL;

/** Fake x402 middleware: pretends the payment settled for `payer`. */
function settledAs(payer: string) {
	// biome-ignore lint/suspicious/noExplicitAny: test middleware stub
	return (async (c: any, next: any) => {
		c.set("x402Payer", payer);
		await next();
		// biome-ignore lint/suspicious/noExplicitAny: matches middleware handler type
	}) as any;
}

describe.skipIf(SKIP)("x402-paid subgraph writes", () => {
	const PAYER = `SP${crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
	const SUBGRAPH = "paid-deploy-test-sg";
	let accountId: string;
	let prevMode: string | undefined;

	beforeAll(async () => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});

	afterAll(async () => {
		const db = getDb();
		await db.deleteFrom("subgraphs").where("name", "=", SUBGRAPH).execute();
		await db
			.deleteFrom("accounts")
			.where("wallet_principal", "=", PAYER)
			.execute();
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("resolveWalletAccount is find-or-create idempotent", async () => {
		const db = getDb();
		const first = await resolveWalletAccount(db, PAYER);
		const second = await resolveWalletAccount(db, PAYER);
		expect(first.id).toBe(second.id);
		accountId = first.id;
		const row = await db
			.selectFrom("accounts")
			.select(["ghost", "plan"])
			.where("id", "=", accountId)
			.executeTakeFirstOrThrow();
		expect(row.ghost).toBe(true);
		expect(row.plan).toBe("none"); // genesis clamp applies by construction
	});

	test("paid deploy route threads the wallet identity into the deploy", async () => {
		let seen: { accountId: string; paidTtlMs?: number } | undefined;
		const app = new Hono();
		app.onError(errorHandler);
		registerPaidWriteRoutes(app as never, {
			x402DeployMiddleware: settledAs(PAYER),
			x402RenewMiddleware: settledAs(PAYER),
			deploy: (async (_c: unknown, identity: typeof seen) => {
				seen = identity;
				return Response.json({ action: "created" }, { status: 201 });
				// biome-ignore lint/suspicious/noExplicitAny: stub
			}) as any,
		});
		const res = await app.request("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: SUBGRAPH, handlerCode: "x" }),
		});
		expect(res.status).toBe(201);
		expect(seen?.accountId).toBe(accountId);
		expect(seen?.paidTtlMs).toBeGreaterThan(0);
	});

	test("paid deploy rejects BYO databases", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		registerPaidWriteRoutes(app as never, {
			x402DeployMiddleware: settledAs(PAYER),
			x402RenewMiddleware: settledAs(PAYER),
			// biome-ignore lint/suspicious/noExplicitAny: stub
			deploy: (async () => Response.json({ ok: true })) as any,
		});
		const res = await app.request("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: SUBGRAPH,
				handlerCode: "x",
				databaseUrl: "postgres://their-db",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("renew extends expiry from max(now, current)", async () => {
		const db = getDb();
		const initialExpiry = new Date(Date.now() + 60_000);
		await registerSubgraph(db, {
			name: SUBGRAPH,
			version: "1.0.0",
			accountId,
			schemaName: `sg_paid_${accountId.slice(0, 8)}`.replace(/-/g, "_"),
			definition: { name: SUBGRAPH, sources: {}, schema: {}, handlers: {} },
			schemaHash: "paid-deploy-test-hash",
			handlerPath: "/tmp/paid-deploy-test.ts",
			startBlock: 1,
		});
		await db
			.updateTable("subgraphs")
			.set({ expires_at: initialExpiry })
			.where("name", "=", SUBGRAPH)
			.execute();

		const app = new Hono();
		app.onError(errorHandler);
		registerPaidWriteRoutes(app as never, {
			x402DeployMiddleware: settledAs(PAYER),
			x402RenewMiddleware: settledAs(PAYER),
			// biome-ignore lint/suspicious/noExplicitAny: stub
			deploy: (async () => Response.json({ ok: true })) as any,
		});
		const res = await app.request(`/${SUBGRAPH}/renew`, { method: "POST" });
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		const got = new Date(body.expires_at).getTime();
		expect(got).toBeGreaterThan(initialExpiry.getTime());

		// renewal by a stranger's wallet → 404 (no ownership leak)
		const strangerApp = new Hono();
		strangerApp.onError(errorHandler);
		registerPaidWriteRoutes(strangerApp as never, {
			x402DeployMiddleware: settledAs("SP_STRANGER"),
			x402RenewMiddleware: settledAs("SP_STRANGER"),
			// biome-ignore lint/suspicious/noExplicitAny: stub
			deploy: (async () => Response.json({ ok: true })) as any,
		});
		const denied = await strangerApp.request(`/${SUBGRAPH}/renew`, {
			method: "POST",
		});
		expect(denied.status).toBe(404);
	});
});
