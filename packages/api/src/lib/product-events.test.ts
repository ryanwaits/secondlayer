import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import { createMagicLink } from "@secondlayer/platform/db/queries/accounts";
import { getDb } from "@secondlayer/shared/db";
import { generateSessionToken } from "../auth/keys.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";
import {
	BrowserDistinctIdSchema,
	SigninFromSchema,
	trackProductEvent,
	visitorSubject,
} from "./product-events.ts";
import { meterRowsDelivered } from "./read-credits.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

type Sent = {
	api_key: string;
	event: string;
	distinct_id: string;
	timestamp: string;
	properties: Record<string, unknown>;
};

/** Every capture the helper sends, read off a fake fetch. Nothing in these
 *  tests reaches the network (a magic-link email included). */
let sent: Sent[] = [];
const fetchSpy = spyOn(globalThis, "fetch");

const saved: Record<string, string | undefined> = {};
const ENV = ["POSTHOG_PROJECT_TOKEN", "INSTANCE_MODE", "DEV_MODE"] as const;

const accountIds: string[] = [];
const emails: string[] = [];

beforeAll(() => {
	for (const k of ENV) saved[k] = process.env[k];
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
});

beforeEach(async () => {
	process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
	sent = [];
	fetchSpy.mockImplementation((async (input, init) => {
		if (String(input) === "https://us.i.posthog.com/capture/") {
			sent.push(JSON.parse(String(init?.body)));
		}
		return new Response("{}");
	}) as typeof fetch);
	if (HAS_DB) await getRateLimitStore().clear();
});

afterEach(() => {
	fetchSpy.mockReset();
});

afterAll(async () => {
	fetchSpy.mockRestore();
	for (const k of ENV) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
	if (!HAS_DB) return;
	if (emails.length > 0) {
		const rows = await db
			.selectFrom("accounts")
			.select("id")
			.where("email", "in", emails)
			.execute();
		accountIds.push(...rows.map((r) => r.id));
		await db.deleteFrom("magic_links").where("email", "in", emails).execute();
	}
	if (accountIds.length > 0) {
		// Sessions, keys and ledger rows cascade with the account.
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe("trackProductEvent", () => {
	test("sends nothing when the project token is unset", () => {
		Reflect.deleteProperty(process.env, "POSTHOG_PROJECT_TOKEN");
		trackProductEvent(
			{ distinctId: "acct" },
			{ event: "account_created", properties: { via: "signin" } },
		);
		expect(sent).toEqual([]);
	});

	test("sends the event to PostHog with geoip off and the person kept", () => {
		trackProductEvent(
			{ distinctId: "acct_1" },
			{ event: "api_key_created", properties: { product: "account" } },
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			api_key: "phc_test",
			event: "api_key_created",
			distinct_id: "acct_1",
			properties: {
				product: "account",
				$lib: "secondlayer-api",
				$geoip_disable: true,
			},
		});
		expect(sent[0].properties).not.toHaveProperty("$process_person_profile");
	});

	test("an anonymous subject makes no person profile", () => {
		trackProductEvent(
			{ distinctId: "ghost_1", anonymous: true },
			{ event: "docs_key_minted", properties: { signed_in: false } },
		);
		expect(sent[0].properties.$process_person_profile).toBe(false);
	});

	test("a failing transport never throws to the caller", () => {
		fetchSpy.mockImplementation((() => {
			throw new Error("down");
		}) as unknown as typeof fetch);
		expect(() =>
			trackProductEvent(
				{ distinctId: "acct" },
				{ event: "account_created", properties: { via: "signin" } },
			),
		).not.toThrow();
	});

	test("a visitor is the browser's id, else the fallback without a person", () => {
		expect(visitorSubject("anon_1", "ghost_1")).toEqual({
			distinctId: "anon_1",
		});
		expect(visitorSubject(undefined, "ghost_1")).toEqual({
			distinctId: "ghost_1",
			anonymous: true,
		});
		expect(visitorSubject(undefined).anonymous).toBe(true);
	});

	test("bad analytics fields read as defaults instead of failing", () => {
		expect(SigninFromSchema.parse("lasting_key")).toBe("lasting_key");
		expect(SigninFromSchema.parse("elsewhere")).toBe("signin");
		expect(SigninFromSchema.parse(undefined)).toBe("signin");
		expect(BrowserDistinctIdSchema.parse(42)).toBeUndefined();
		expect(BrowserDistinctIdSchema.parse("x".repeat(201))).toBeUndefined();
	});
});

const app = createApiApp("platform");

const post = (
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
) =>
	app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});

function freshEmail(): string {
	const email = `product-events-${crypto.randomUUID()}@example.com`;
	emails.push(email);
	return email;
}

async function makeAccount(
	values: { email?: string | null; ghost?: boolean } = {},
): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ...values })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

async function sessionFor(accountId: string): Promise<string> {
	const { raw, hash, prefix } = generateSessionToken();
	await db
		.insertInto("sessions")
		.values({
			token_hash: hash,
			token_prefix: prefix,
			account_id: accountId,
			ip_address: "test",
		})
		.execute();
	return raw;
}

const named = (event: string) => sent.filter((s) => s.event === event);

/** A first read's event is sent off the request path; give it a moment. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe.skipIf(!HAS_DB)("funnel events from the routes", () => {
	test("a link for a new email goes to the browser's id, from the lasting-key panel", async () => {
		const res = await post("/api/auth/magic-link", {
			email: freshEmail(),
			from: "lasting_key",
			distinctId: "anon_browser",
		});
		expect(res.status).toBe(200);
		expect(named("signin_link_sent")).toHaveLength(1);
		const [event] = named("signin_link_sent");
		expect(event.distinct_id).toBe("anon_browser");
		expect(event.properties).toMatchObject({
			new_email: true,
			from: "lasting_key",
		});
		expect(JSON.stringify(event)).not.toContain("@example.com");
	});

	test("a link for an existing account goes to the account, from sign-in by default", async () => {
		const email = freshEmail();
		const id = await makeAccount({ email });
		await post("/api/auth/magic-link", { email, distinctId: "anon_browser" });
		const [event] = named("signin_link_sent");
		expect(event.distinct_id).toBe(id);
		expect(event.properties).toMatchObject({
			new_email: false,
			from: "signin",
		});
	});

	test("a verify that creates the account sends account_created once", async () => {
		const email = freshEmail();
		const verify = async () => {
			await createMagicLink(db, email, crypto.randomUUID(), "123456");
			return post("/api/auth/verify", { email, code: "123456" });
		};
		const first = await verify();
		expect(first.status).toBe(200);
		const body = (await first.json()) as {
			account: { id: string; internal: boolean };
		};
		expect(body.account.internal).toBe(false);
		expect(named("account_created")).toEqual([
			expect.objectContaining({
				distinct_id: body.account.id,
				properties: expect.objectContaining({ via: "signin" }),
			}),
		]);

		expect((await verify()).status).toBe(200);
		expect(named("account_created")).toHaveLength(1);
	});

	test("creating an account key sends api_key_created with its product", async () => {
		const id = await makeAccount();
		const res = await post(
			"/api/keys",
			{ name: "events" },
			{ authorization: `Bearer ${await sessionFor(id)}` },
		);
		expect(res.status).toBe(201);
		expect(named("api_key_created")).toEqual([
			expect.objectContaining({
				distinct_id: id,
				properties: expect.objectContaining({ product: "account" }),
			}),
		]);
		expect(JSON.stringify(sent)).not.toContain("sk-sl_");
	});

	test("a signed-in docs key sends docs_key_minted to the account", async () => {
		const id = await makeAccount();
		const res = await post(
			"/api/keys/docs",
			{},
			{ authorization: `Bearer ${await sessionFor(id)}` },
		);
		expect(res.status).toBe(201);
		expect(named("docs_key_minted")).toEqual([
			expect.objectContaining({
				distinct_id: id,
				properties: expect.objectContaining({ signed_in: true }),
			}),
		]);
	});

	test("a signed-out docs key goes to the browser's id, else the ghost's without a person", async () => {
		const withId = await post(
			"/api/public/docs-key",
			{ distinctId: "anon_reader" },
			{ "x-forwarded-for": "198.51.100.201" },
		);
		expect(withId.status).toBe(201);
		const without = await post(
			"/api/public/docs-key",
			{},
			{ "x-forwarded-for": "198.51.100.202" },
		);
		expect(without.status).toBe(201);
		const ghosts = await db
			.selectFrom("api_keys")
			.select("account_id")
			.where("ip_address", "in", ["198.51.100.201", "198.51.100.202"])
			.where("product", "=", "docs")
			.orderBy("created_at")
			.execute();
		accountIds.push(...ghosts.map((g) => g.account_id));

		const events = named("docs_key_minted");
		expect(events).toHaveLength(2);
		expect(events[0].distinct_id).toBe("anon_reader");
		expect(events[0].properties).toMatchObject({ signed_in: false });
		expect(events[0].properties).not.toHaveProperty("$process_person_profile");
		expect(events[1].distinct_id).toBe(ghosts[1].account_id);
		expect(events[1].properties.$process_person_profile).toBe(false);
	});

	test("an account's first metered read sends first_request once", async () => {
		const id = await makeAccount();
		await meterRowsDelivered(id, 5, "index");
		await settle();
		await meterRowsDelivered(id, 5, "streams");
		await settle();
		expect(named("first_request")).toEqual([
			expect.objectContaining({
				distinct_id: id,
				properties: expect.objectContaining({ source: "index", ghost: false }),
			}),
		]);
	});

	test("an account that read before this process started sends no first_request", async () => {
		const id = await makeAccount();
		Reflect.deleteProperty(process.env, "POSTHOG_PROJECT_TOKEN");
		await meterRowsDelivered(id, 5, "index");
		process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
		await meterRowsDelivered(id, 5, "index");
		await settle();
		expect(named("first_request")).toEqual([]);
	});

	test("a ghost's first read goes out without a person", async () => {
		const id = await makeAccount({ ghost: true });
		await meterRowsDelivered(id, 5, "streams");
		await settle();
		const [event] = named("first_request");
		expect(event.distinct_id).toBe(id);
		expect(event.properties).toMatchObject({
			ghost: true,
			$process_person_profile: false,
		});
	});
});
