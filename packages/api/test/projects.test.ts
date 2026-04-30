import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import projectsRouter from "../src/routes/projects.ts";

const SKIP = !process.env.DATABASE_URL;
const ACCOUNT_A = "00000000-0000-4000-8000-0000000000a1";
const ACCOUNT_B = "00000000-0000-4000-8000-0000000000b2";
const PROJECT_SLUG = "ownership-guard-project";
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
