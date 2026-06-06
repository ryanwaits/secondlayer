import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import projectsRouter from "../src/routes/projects.ts";

// Per-project instance provisioning is dormant since the 2026-05-14 shared-rip:
// subgraphs + subscriptions are served from api.secondlayer.tools directly, so
// POST /projects/:slug/instance unconditionally refuses. The old ownership /
// provisioner / audit tests were removed with the feature they covered.
type TestEnv = { Variables: { accountId: string } };

describe("Projects API instance provisioning (dormant)", () => {
	const app = new Hono<TestEnv>();
	app.use("*", async (c, next) => {
		c.set("accountId", "00000000-0000-4000-8000-0000000000a1");
		await next();
	});
	app.route("/projects", projectsRouter);

	test("POST /:slug/instance refuses with 503 DEDICATED_PROVISIONING_DISABLED", async () => {
		const res = await app.request("/projects/any-project/instance", {
			method: "POST",
			body: JSON.stringify({ plan: "launch" }),
		});
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({
			code: "DEDICATED_PROVISIONING_DISABLED",
		});
	});
});
