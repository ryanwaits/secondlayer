import { afterEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import {
	InProcRateLimitStore,
	_resetRateLimitStoreForTests,
} from "../auth/rate-limit-store.ts";
import { createContactRouter, parseContact } from "./public-contact.ts";

afterEach(async () => {
	await _resetRateLimitStoreForTests();
});

const valid = {
	name: "Ada Lovelace",
	email: "ada@example.com",
	message: "We index about 2B rows a month and need an invoice.",
};

function noDbRouter() {
	return createContactRouter({
		getDb: () => {
			throw new Error("db touched");
		},
		rateLimitStore: new InProcRateLimitStore(),
	});
}

function post(router: Hono, body: unknown): Promise<Response> {
	const h = new Hono();
	h.route("/api/public/contact", router);
	return Promise.resolve(
		h.request("/api/public/contact", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("parseContact", () => {
	test("trims fields and nulls blank optionals", () => {
		expect(
			parseContact({
				...valid,
				name: "  Ada Lovelace ",
				company: "   ",
				volume: "",
			}),
		).toEqual({
			ok: {
				name: "Ada Lovelace",
				email: "ada@example.com",
				company: null,
				volume: null,
				message: valid.message,
				source_page: null,
			},
		});
	});

	test("names the missing required field and how to fix it", () => {
		expect(parseContact({ ...valid, name: "" })).toEqual({
			error: "name is required so we know who to reply to",
		});
		expect(parseContact({ ...valid, email: undefined })).toEqual({
			error: "email is required so we can reply",
		});
		expect(parseContact({ ...valid, message: "short" })).toEqual({
			error: "message is required (10 characters minimum)",
		});
	});

	test("refuses a malformed email", () => {
		const r = parseContact({ ...valid, email: "not-an-email" });
		expect("error" in r && r.error).toContain("email must be a valid address");
	});

	test("refuses oversize fields instead of truncating them", () => {
		expect("error" in parseContact({ ...valid, name: "a".repeat(121) })).toBe(
			true,
		);
		expect(
			"error" in parseContact({ ...valid, company: "a".repeat(161) }),
		).toBe(true);
		expect(
			"error" in parseContact({ ...valid, message: "a".repeat(4001) }),
		).toBe(true);
		expect(
			"error" in
				parseContact({ ...valid, email: `${"a".repeat(250)}@example.com` }),
		).toBe(true);
	});

	test("accepts every volume bucket and refuses others", () => {
		for (const volume of ["lt10m", "10m-100m", "100m-1b", "gt1b", "unsure"]) {
			expect("ok" in parseContact({ ...valid, volume })).toBe(true);
		}
		expect("error" in parseContact({ ...valid, volume: "huge" })).toBe(true);
	});

	test("keeps a page path as source_page and drops anything else", () => {
		const keep = parseContact({ ...valid, source_page: "/pricing" });
		expect("ok" in keep && keep.ok.source_page).toBe("/pricing");
		const drop = parseContact({
			...valid,
			source_page: "https://evil.example/x",
		});
		expect("ok" in drop && drop.ok.source_page).toBeNull();
	});

	test("refuses unknown fields but allows the honeypot", () => {
		expect(parseContact({ ...valid, admin: true })).toEqual({
			error: "unknown field: admin",
		});
		expect("ok" in parseContact({ ...valid, website: "" })).toBe(true);
	});
});

describe("POST /api/public/contact without a database", () => {
	test("answers 400 for a body that is not a JSON object", async () => {
		const res = await post(noDbRouter(), [1, 2]);
		expect(res.status).toBe(400);
	});

	test("answers 400 naming the field when validation fails", async () => {
		const res = await post(noDbRouter(), { ...valid, email: "" });
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toContain("email");
	});

	test("answers 201 for a filled honeypot without touching the database", async () => {
		const res = await post(noDbRouter(), { ...valid, website: "http://spam" });
		expect(res.status).toBe(201);
		expect(typeof ((await res.json()) as { id: string }).id).toBe("string");
	});

	test("refuses the 31st message from one address within the hour", async () => {
		const router = createContactRouter({
			getDb: () => {
				throw new Error("db touched");
			},
			rateLimitStore: new InProcRateLimitStore(),
		});
		const app = new Hono();
		app.route("/c", router);
		const send = () =>
			app.request("/c", {
				method: "POST",
				headers: { "content-type": "application/json" },
				// Invalid body: reaches the limiter, then stops at validation.
				body: JSON.stringify({ name: "" }),
			});
		for (let i = 0; i < 30; i++) expect((await send()).status).toBe(400);
		const over = await send();
		expect(over.status).toBe(500); // bare Hono: RateLimitError has no handler
		expect(over.headers.get("retry-after")).not.toBeNull();
	});
});

describe("POST /api/public/contact with a database", () => {
	const HAS_DB = !!process.env.DATABASE_URL;

	test.skipIf(!HAS_DB)(
		"stores the message unnotified without a notify address and dedupes within the hour",
		async () => {
			const prior = process.env.CONTACT_NOTIFY_EMAIL;
			process.env.CONTACT_NOTIFY_EMAIL = "";
			const email = `contact-test-${crypto.randomUUID()}@example.com`;
			const router = createContactRouter({
				rateLimitStore: new InProcRateLimitStore(),
			});
			try {
				const first = await post(router, { ...valid, email });
				expect(first.status).toBe(201);
				const { id } = (await first.json()) as { id: string };

				const row = await getDb()
					.selectFrom("contact_requests")
					.selectAll()
					.where("id", "=", id)
					.executeTakeFirstOrThrow();
				expect(row.notified_at).toBeNull();
				expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);

				const again = await post(router, {
					...valid,
					email: email.toUpperCase(),
				});
				expect(((await again.json()) as { id: string }).id).toBe(id);
			} finally {
				await getDb()
					.deleteFrom("contact_requests")
					.where("email", "ilike", email)
					.execute();
				if (prior === undefined) {
					Reflect.deleteProperty(process.env, "CONTACT_NOTIFY_EMAIL");
				} else process.env.CONTACT_NOTIFY_EMAIL = prior;
			}
		},
	);
});
