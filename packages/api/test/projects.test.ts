import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import projectsRouter from "../src/routes/projects.ts";

const SKIP = !process.env.DATABASE_URL;
const ACCOUNT_A = "00000000-0000-4000-8000-0000000000a1";
const ACCOUNT_B = "00000000-0000-4000-8000-0000000000b2";
const ACCOUNT_C = "00000000-0000-4000-8000-0000000000c3";
const PROJECT_SLUG = "ownership-guard-project";
const AUDIT_PROJECT_SLUG = "project-instance-audit";
type TestEnv = {
	Variables: {
		accountId: string;
	};
};

describe.skipIf(SKIP)("Projects API tenant ownership", () => {
	const app = new Hono<TestEnv>();
	app.use("*", async (c, next) => {
		c.set("accountId", ACCOUNT_B);
		await next();
	});
	app.route("/projects", projectsRouter);

	beforeAll(async () => {
		const db = getDb();
		await db.deleteFrom("projects").where("slug", "=", PROJECT_SLUG).execute();
		await db
			.deleteFrom("accounts")
			.where("id", "in", [ACCOUNT_A, ACCOUNT_B])
			.execute();
		await db
			.insertInto("accounts")
			.values([
				{ id: ACCOUNT_A, email: "ownership-a@example.com" },
				{ id: ACCOUNT_B, email: "ownership-b@example.com" },
			])
			.execute();
		await db
			.insertInto("projects")
			.values({
				name: "Ownership Guard",
				slug: PROJECT_SLUG,
				account_id: ACCOUNT_A,
			})
			.execute();
	});

	afterAll(async () => {
		const db = getDb();
		await db.deleteFrom("projects").where("slug", "=", PROJECT_SLUG).execute();
		await db
			.deleteFrom("accounts")
			.where("id", "in", [ACCOUNT_A, ACCOUNT_B])
			.execute();
	});

	test("account B cannot provision an instance for account A's project", async () => {
		const res = await app.request(`/projects/${PROJECT_SLUG}/instance`, {
			method: "POST",
			body: JSON.stringify({ plan: "hobby" }),
		});

		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: "Project not found" });
	});
});

describe.skipIf(SKIP)("Projects API instance provisioning audit", () => {
	const app = new Hono<TestEnv>();
	const originalInstanceMode = process.env.INSTANCE_MODE;
	const originalSecretsKey = process.env.SECONDLAYER_SECRETS_KEY;
	const originalProvisionerUrl = process.env.PROVISIONER_URL;
	const originalProvisionerSecret = process.env.PROVISIONER_SECRET;
	let provisioner: ReturnType<typeof Bun.serve> | null = null;

	app.use("*", async (c, next) => {
		c.set("accountId", ACCOUNT_C);
		await next();
	});
	app.route("/projects", projectsRouter);

	beforeAll(async () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ??
			"0000000000000000000000000000000000000000000000000000000000000000";
		process.env.PROVISIONER_SECRET = "test-provisioner-secret";

		const db = getDb();
		await cleanupAuditFixture();
		await db
			.insertInto("accounts")
			.values({ id: ACCOUNT_C, email: "project-audit@example.com" })
			.execute();
		await db
			.insertInto("projects")
			.values({
				name: "Project Instance Audit",
				slug: AUDIT_PROJECT_SLUG,
				account_id: ACCOUNT_C,
			})
			.execute();
	});

	afterAll(async () => {
		provisioner?.stop();
		if (originalInstanceMode === undefined) {
			Reflect.deleteProperty(process.env, "INSTANCE_MODE");
		} else {
			process.env.INSTANCE_MODE = originalInstanceMode;
		}
		if (originalSecretsKey === undefined) {
			Reflect.deleteProperty(process.env, "SECONDLAYER_SECRETS_KEY");
		} else {
			process.env.SECONDLAYER_SECRETS_KEY = originalSecretsKey;
		}
		if (originalProvisionerUrl === undefined) {
			Reflect.deleteProperty(process.env, "PROVISIONER_URL");
		} else {
			process.env.PROVISIONER_URL = originalProvisionerUrl;
		}
		if (originalProvisionerSecret === undefined) {
			Reflect.deleteProperty(process.env, "PROVISIONER_SECRET");
		} else {
			process.env.PROVISIONER_SECRET = originalProvisionerSecret;
		}
		await cleanupAuditFixture();
	});

	test("records start and failure audit rows when provisioner rejects", async () => {
		startProvisioner(
			() => new Response("capacity unavailable", { status: 503 }),
		);

		const res = await app.request(`/projects/${AUDIT_PROJECT_SLUG}/instance`, {
			method: "POST",
			body: JSON.stringify({ plan: "hobby" }),
		});

		expect(res.status).toBe(502);
		expect(await res.json()).toMatchObject({
			error: "Provisioner rejected the request",
			code: "PROVISIONER_REJECTED",
			status: 503,
			detail: "capacity unavailable",
			projectSlug: AUDIT_PROJECT_SLUG,
			plan: "hobby",
		});

		const rows = await getDb()
			.selectFrom("provisioning_audit_log")
			.selectAll()
			.where("account_id", "=", ACCOUNT_C)
			.orderBy("created_at", "asc")
			.execute();

		expect(rows.map((row) => [row.event, row.status])).toEqual([
			["provision.start", "ok"],
			["provision.failure", "error"],
		]);
		expect(rows[0]?.detail).toMatchObject({
			route: "projects.instance",
			projectSlug: AUDIT_PROJECT_SLUG,
			plan: "hobby",
		});
		expect(rows[1]?.detail).toMatchObject({
			route: "projects.instance",
			projectSlug: AUDIT_PROJECT_SLUG,
			plan: "hobby",
			provisioner: { status: 503, body: "capacity unavailable" },
		});
	});

	test("records start and success audit rows after tenant insert", async () => {
		await getDb()
			.deleteFrom("provisioning_audit_log")
			.where("account_id", "=", ACCOUNT_C)
			.execute();
		startProvisioner(() =>
			Response.json({
				slug: "audit-tenant-ok",
				plan: "hobby",
				apiUrlInternal: "http://audit-tenant-ok-api:3000",
				apiUrlPublic: "https://audit-tenant-ok.secondlayer.tools",
				targetDatabaseUrl:
					"postgres://secondlayer:secret@audit-tenant-ok-pg:5432/secondlayer",
				tenantJwtSecret: "tenant-jwt-secret",
				anonKey: "anon-key",
				serviceKey: "service-key",
				containerIds: {
					postgres: "pg-container",
					api: "api-container",
					processor: "processor-container",
				},
				volumeName: "audit-volume",
				createdAt: new Date(0).toISOString(),
			}),
		);

		const res = await app.request(`/projects/${AUDIT_PROJECT_SLUG}/instance`, {
			method: "POST",
			body: JSON.stringify({ plan: "hobby" }),
		});

		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({
			tenant: {
				slug: "audit-tenant-ok",
				plan: "hobby",
				projectId: expect.any(String),
			},
			credentials: {
				apiUrl: "https://audit-tenant-ok.secondlayer.tools",
				anonKey: "anon-key",
				serviceKey: "service-key",
			},
		});

		const rows = await getDb()
			.selectFrom("provisioning_audit_log")
			.selectAll()
			.where("account_id", "=", ACCOUNT_C)
			.orderBy("created_at", "asc")
			.execute();

		expect(rows.map((row) => [row.event, row.status])).toEqual([
			["provision.start", "ok"],
			["provision.success", "ok"],
		]);
		expect(rows[1]?.tenant_slug).toBe("audit-tenant-ok");
		expect(rows[1]?.detail).toMatchObject({
			route: "projects.instance",
			projectSlug: AUDIT_PROJECT_SLUG,
			plan: "hobby",
		});
	});

	function startProvisioner(handler: () => Response): void {
		provisioner?.stop();
		provisioner = Bun.serve({
			port: 0,
			fetch(req) {
				if (new URL(req.url).pathname !== "/tenants") {
					return new Response("not found", { status: 404 });
				}
				return handler();
			},
		});
		process.env.PROVISIONER_URL = `http://localhost:${provisioner.port}`;
	}
});

async function cleanupAuditFixture(): Promise<void> {
	const db = getDb();
	await db
		.deleteFrom("provisioning_audit_log")
		.where("account_id", "=", ACCOUNT_C)
		.execute();
	await db.deleteFrom("tenants").where("account_id", "=", ACCOUNT_C).execute();
	await db
		.deleteFrom("projects")
		.where("slug", "=", AUDIT_PROJECT_SLUG)
		.execute();
	await db.deleteFrom("accounts").where("id", "=", ACCOUNT_C).execute();
}
