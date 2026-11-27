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
import { getDb } from "@secondlayer/shared/db";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const emails: string[] = [];
const fetchSpy = spyOn(globalThis, "fetch");

let prevMode: string | undefined;
let prevDev: string | undefined;
let prevResendKey: string | undefined;
let sentEmails = 0;

beforeAll(() => {
	prevMode = process.env.INSTANCE_MODE;
	prevDev = process.env.DEV_MODE;
	prevResendKey = process.env.RESEND_API_KEY;
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
	process.env.RESEND_API_KEY = "re_test_key";
});

beforeEach(async () => {
	sentEmails = 0;
	fetchSpy.mockImplementation((async (input) => {
		if (String(input) === "https://api.resend.com/emails") {
			sentEmails++;
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
	const restore = (k: string, v: string | undefined) => {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	};
	restore("INSTANCE_MODE", prevMode);
	restore("DEV_MODE", prevDev);
	restore("RESEND_API_KEY", prevResendKey);
	if (!HAS_DB || emails.length === 0) return;
	await db.deleteFrom("magic_links").where("email", "in", emails).execute();
});

const app = createApiApp("platform");

function freshEmail(): string {
	const email = `auth-magic-link-${crypto.randomUUID()}@example.com`;
	emails.push(email);
	return email;
}

describe.skipIf(!HAS_DB)(
	"POST /api/auth/magic-link per-email rate limit",
	() => {
		test("allows 5 requests and returns 429 with Retry-After on the 6th across distinct IPs without sending a 6th email", async () => {
			const email = freshEmail();
			const responses: Response[] = [];

			for (let i = 1; i <= 6; i++) {
				responses.push(
					await app.request("/api/auth/magic-link", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-forwarded-for": `198.51.100.${i}`,
						},
						body: JSON.stringify({ email }),
					}),
				);
			}

			expect(responses.slice(0, 5).map((r) => r.status)).toEqual([
				200, 200, 200, 200, 200,
			]);
			const sixth = responses[5];
			expect(sixth?.status).toBe(429);
			const retryAfter = Number(sixth?.headers.get("retry-after"));
			expect(Number.isFinite(retryAfter) && retryAfter > 0).toBe(true);
			expect(sentEmails).toBe(5);

			const rows = await db
				.selectFrom("magic_links")
				.select("id")
				.where("email", "=", email)
				.execute();
			expect(rows).toHaveLength(5);
		});
	},
);
