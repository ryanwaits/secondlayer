import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolveAccountUrl, resolveIdentity } from "./base.ts";

const ENV = [
	"SECONDLAYER_API_KEY",
	"INSTANCE_TOKEN",
	"SECONDLAYER_API_URL",
	"SL_CREDITS_API_URL",
	"ARCHIVE_OPS_API_URL",
] as const;

describe("resolveIdentity", () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = {};
		for (const k of ENV) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
	});

	afterEach(() => {
		for (const k of ENV) {
			if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = saved[k];
		}
	});

	const cases: {
		name: string;
		target: "account" | "instance";
		env: Record<string, string>;
		session?: string;
		expect: { source: string; token: string | undefined };
	}[] = [
		{
			name: "account: env key beats a stored session",
			target: "account",
			env: { SECONDLAYER_API_KEY: "sk-sl_env" },
			session: "ss-sl_session",
			expect: { source: "env", token: "sk-sl_env" },
		},
		{
			name: "account: session used when no env key",
			target: "account",
			env: {},
			session: "ss-sl_session",
			expect: { source: "session", token: "ss-sl_session" },
		},
		{
			name: "account: a non-account env value is ignored, session wins",
			target: "account",
			env: { SECONDLAYER_API_KEY: "deadbeef" },
			session: "ss-sl_session",
			expect: { source: "session", token: "ss-sl_session" },
		},
		{
			name: "account: nothing set resolves to none",
			target: "account",
			env: {},
			expect: { source: "none", token: undefined },
		},
		{
			name: "instance: INSTANCE_TOKEN beats a session",
			target: "instance",
			env: { INSTANCE_TOKEN: "abc123" },
			session: "ss-sl_session",
			expect: { source: "env", token: "abc123" },
		},
		{
			name: "instance: the account key is never an instance credential",
			target: "instance",
			env: { SECONDLAYER_API_KEY: "sk-sl_env" },
			expect: { source: "none", token: undefined },
		},
	];

	for (const c of cases) {
		it(c.name, () => {
			Object.assign(process.env, c.env);
			const id = resolveIdentity(c.target, { session: c.session });
			expect(id.source).toBe(c.expect.source as never);
			expect(id.token).toBe(c.expect.token);
		});
	}

	it("account url honors SL_CREDITS_API_URL, then ARCHIVE_OPS_API_URL, then hosted", () => {
		expect(resolveAccountUrl()).toBe("https://api.secondlayer.tools");
		process.env.ARCHIVE_OPS_API_URL = "http://old.test/";
		expect(resolveAccountUrl()).toBe("http://old.test");
		process.env.SL_CREDITS_API_URL = "http://new.test";
		expect(resolveAccountUrl()).toBe("http://new.test");
	});
});
