import { afterEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import type { SendEmailInput } from "@secondlayer/shared/email";
import { Hono } from "hono";
import {
	InProcRateLimitStore,
	_resetRateLimitStoreForTests,
} from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";
import { createUpdatesRouter } from "./public-updates.ts";

afterEach(async () => {
	await _resetRateLimitStoreForTests();
});

const BASE = "/api/public/updates";

function mount(router: Hono): Hono {
	const h = new Hono();
	h.route(BASE, router);
	return h;
}

function postJson(
	app: Hono,
	path: string,
	body: unknown,
): Response | Promise<Response> {
	return app.request(`${BASE}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function noDbRouter(rateLimitStore = new InProcRateLimitStore()) {
	return createUpdatesRouter({
		getDb: () => {
			throw new Error("db touched");
		},
		rateLimitStore,
		send: async () => {
			throw new Error("email sent");
		},
	});
}

describe("POST /api/public/updates without a database", () => {
	test("answers 202 for a filled honeypot without touching the database", async () => {
		const res = await postJson(mount(noDbRouter()), "", {
			email: "bot@example.com",
			website: "http://spam",
		});
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ ok: true });
	});

	test("answers 400 naming the fix for a bad email", async () => {
		const res = await postJson(mount(noDbRouter()), "", { email: "nope" });
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe(
			"email must be a valid address, like you@example.com",
		);
	});

	test("answers 400 for an unknown field", async () => {
		const res = await postJson(mount(noDbRouter()), "", {
			email: "a@example.com",
			admin: true,
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe(
			"unknown field: admin",
		);
	});

	test("answers 400 for a body that is not a JSON object", async () => {
		const res = await postJson(mount(noDbRouter()), "", [1]);
		expect(res.status).toBe(400);
	});

	test("refuses the 21st attempt from one address within the hour", async () => {
		const app = mount(noDbRouter());
		const send = () => postJson(app, "", { email: "" });
		for (let i = 0; i < 20; i++) expect((await send()).status).toBe(400);
		const over = await send();
		expect(over.status).toBe(500); // bare Hono: RateLimitError has no handler
		expect(over.headers.get("retry-after")).not.toBeNull();
	});
});

describe("the updates list with a database", () => {
	const HAS_DB = !!process.env.DATABASE_URL;
	const created: string[] = [];

	function address(): string {
		const email = `updates-test-${crypto.randomUUID()}@example.com`;
		created.push(email);
		return email;
	}

	function harness() {
		const sent: SendEmailInput[] = [];
		const router = createUpdatesRouter({
			rateLimitStore: new InProcRateLimitStore(),
			send: async (input) => {
				sent.push(input);
				return { skipped: false };
			},
		});
		return { app: mount(router), sent };
	}

	function row(email: string) {
		return getDb()
			.selectFrom("update_subscribers")
			.selectAll()
			.where((eb) => eb(eb.fn("lower", ["email"]), "=", email.toLowerCase()))
			.executeTakeFirstOrThrow();
	}

	afterEach(async () => {
		if (!HAS_DB || created.length === 0) return;
		await getDb()
			.deleteFrom("update_subscribers")
			.where("email", "in", created.splice(0))
			.execute();
	});

	test.skipIf(!HAS_DB)(
		"a new address becomes pending and gets one confirm email",
		async () => {
			const { app, sent } = harness();
			const email = address();
			const res = await postJson(app, "", { email, source_page: "/blog" });
			expect(res.status).toBe(202);
			expect(await res.json()).toEqual({ ok: true });

			const r = await row(email);
			expect(r.status).toBe("pending");
			expect(r.source_page).toBe("/blog");
			expect(r.ip_hash).toMatch(/^[0-9a-f]{64}$/);
			expect(r.confirm_sent_at).not.toBeNull();
			expect(sent).toHaveLength(1);
			expect(sent[0]?.to).toBe(email);
			expect(sent[0]?.from).toBe("Secondlayer <dev@secondlayer.tools>");
			expect(sent[0]?.html).toContain(encodeURIComponent(r.token));
		},
	);

	test.skipIf(!HAS_DB)(
		"a repeat within the cooldown sends nothing and still answers 202",
		async () => {
			const { app, sent } = harness();
			const email = address();
			await postJson(app, "", { email });
			const again = await postJson(app, "", { email: email.toUpperCase() });
			expect(again.status).toBe(202);
			expect(sent).toHaveLength(1);
		},
	);

	test.skipIf(!HAS_DB)(
		"a pending address past the cooldown is re-sent the same token",
		async () => {
			const { app, sent } = harness();
			const email = address();
			await postJson(app, "", { email });
			const first = await row(email);
			await getDb()
				.updateTable("update_subscribers")
				.set({ confirm_sent_at: new Date(Date.now() - 11 * 60_000) })
				.where("id", "=", first.id)
				.execute();
			await postJson(app, "", { email });
			expect(sent).toHaveLength(2);
			expect(sent[1]?.html).toContain(encodeURIComponent(first.token));
		},
	);

	test.skipIf(!HAS_DB)(
		"a confirmed address gets 202 and no email",
		async () => {
			const { app, sent } = harness();
			const email = address();
			await postJson(app, "", { email });
			const r = await row(email);
			await postJson(app, "/confirm", { token: r.token });
			sent.length = 0;
			const res = await postJson(app, "", { email });
			expect(res.status).toBe(202);
			expect(await res.json()).toEqual({ ok: true });
			expect(sent).toHaveLength(0);
			expect((await row(email)).status).toBe("confirmed");
		},
	);

	test.skipIf(!HAS_DB)(
		"a skipped or failed send leaves confirm_sent_at null",
		async () => {
			const email = address();
			const failing = createUpdatesRouter({
				rateLimitStore: new InProcRateLimitStore(),
				send: async () => {
					throw new Error("resend down");
				},
			});
			const res = await postJson(mount(failing), "", { email });
			expect(res.status).toBe(202);
			expect((await row(email)).confirm_sent_at).toBeNull();

			const skipping = createUpdatesRouter({
				rateLimitStore: new InProcRateLimitStore(),
				send: async () => ({ skipped: true }),
			});
			await postJson(mount(skipping), "", { email });
			expect((await row(email)).confirm_sent_at).toBeNull();
		},
	);

	test.skipIf(!HAS_DB)(
		"confirm: valid, idempotent, expired, unknown",
		async () => {
			const { app } = harness();
			const email = address();
			await postJson(app, "", { email });
			const r = await row(email);

			const ok = await postJson(app, "/confirm", { token: r.token });
			expect(ok.status).toBe(200);
			expect(await ok.json()).toEqual({ status: "confirmed", email });
			expect((await row(email)).confirmed_at).not.toBeNull();

			const again = await postJson(app, "/confirm", { token: r.token });
			expect(again.status).toBe(200);

			const stale = address();
			await postJson(app, "", { email: stale });
			const s = await row(stale);
			await getDb()
				.updateTable("update_subscribers")
				.set({ confirm_sent_at: new Date(Date.now() - 8 * 24 * 3_600_000) })
				.where("id", "=", s.id)
				.execute();
			const expired = await postJson(app, "/confirm", { token: s.token });
			expect(expired.status).toBe(410);
			expect(await expired.json()).toEqual({ status: "expired" });

			const unknown = await postJson(app, "/confirm", { token: "nope" });
			expect(unknown.status).toBe(404);
			expect(await unknown.json()).toEqual({ status: "invalid" });
		},
	);

	test.skipIf(!HAS_DB)(
		"a form-encoded one-click unsubscribe through the full app works, then resubscribe",
		async () => {
			const { app, sent } = harness();
			const email = address();
			await postJson(app, "", { email });
			const r = await row(email);
			await postJson(app, "/confirm", { token: r.token });

			const full = createApiApp("platform");
			const un = await full.request(
				`${BASE}/unsubscribe?t=${encodeURIComponent(r.token)}`,
				{
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
				},
			);
			expect(un.status).toBe(200);
			expect(await un.json()).toEqual({ status: "unsubscribed", email });
			const gone = await row(email);
			expect(gone.status).toBe("unsubscribed");
			expect(gone.unsubscribed_at).not.toBeNull();

			// Unsubscribing again keeps the first timestamp.
			await postJson(app, `/unsubscribe?t=${r.token}`, {});
			expect((await row(email)).unsubscribed_at?.getTime()).toBe(
				gone.unsubscribed_at?.getTime() as number,
			);

			const re = await postJson(app, "/resubscribe", { token: r.token });
			expect(re.status).toBe(200);
			expect(await re.json()).toEqual({ status: "confirmed", email });
			const back = await row(email);
			expect(back.status).toBe("confirmed");
			expect(back.unsubscribed_at).toBeNull();
			expect(sent).toHaveLength(1);
		},
	);

	test.skipIf(!HAS_DB)(
		"an unsubscribed address that joins again goes pending with a new confirm email",
		async () => {
			const { app, sent } = harness();
			const email = address();
			await postJson(app, "", { email });
			const r = await row(email);
			await postJson(app, "/confirm", { token: r.token });
			await postJson(app, "/unsubscribe", { token: r.token });
			sent.length = 0;

			const res = await postJson(app, "", { email });
			expect(res.status).toBe(202);
			const back = await row(email);
			expect(back.status).toBe("pending");
			expect(back.unsubscribed_at).toBeNull();
			expect(sent).toHaveLength(1);
		},
	);

	test.skipIf(!HAS_DB)(
		"resubscribe: pending is 409, unknown is 404",
		async () => {
			const { app } = harness();
			const email = address();
			await postJson(app, "", { email });
			const r = await row(email);
			const pending = await postJson(app, "/resubscribe", { token: r.token });
			expect(pending.status).toBe(409);
			expect(await pending.json()).toEqual({ status: "pending" });

			const unknown = await postJson(app, "/resubscribe", { token: "nope" });
			expect(unknown.status).toBe(404);
			const unsub = await postJson(app, "/unsubscribe", { token: "nope" });
			expect(unsub.status).toBe(404);
		},
	);
});
