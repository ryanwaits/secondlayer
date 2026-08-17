import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import {
	allowsAnonymousRead,
	invalidCredentialError,
	missingCredentialError,
	v1InstanceGate,
} from "./read-plane.ts";

function restoreEnv(key: string, prev: string | undefined): void {
	if (prev === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = prev;
}

describe("allowsAnonymousRead", () => {
	const prevMode = process.env.INSTANCE_MODE;
	const prevHost = process.env.LISTEN_HOST;
	const prevPublish = process.env.API_PUBLISH_ADDR;

	afterEach(() => {
		restoreEnv("INSTANCE_MODE", prevMode);
		restoreEnv("LISTEN_HOST", prevHost);
		restoreEnv("API_PUBLISH_ADDR", prevPublish);
	});

	test("a loopback bind serves reads with no credential", () => {
		process.env.INSTANCE_MODE = "oss";
		for (const host of ["127.0.0.1", "localhost", "::1"]) {
			process.env.LISTEN_HOST = host;
			expect(allowsAnonymousRead(), host).toBe(true);
		}
	});

	test("an unset bind defaults to loopback, so reads stay open", () => {
		process.env.INSTANCE_MODE = "oss";
		Reflect.deleteProperty(process.env, "LISTEN_HOST");
		expect(allowsAnonymousRead()).toBe(true);
	});

	test("any bind past loopback demands a credential", () => {
		process.env.INSTANCE_MODE = "oss";
		for (const host of ["0.0.0.0", "::", "192.168.1.9", "10.0.0.4"]) {
			process.env.LISTEN_HOST = host;
			expect(allowsAnonymousRead(), host).toBe(false);
		}
	});

	// The container case: LISTEN_HOST is always 0.0.0.0 there, so the publish
	// spec compose was given is the only honest signal of who can reach us.
	test("a loopback publish spec opens reads despite the 0.0.0.0 bind", () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "0.0.0.0";
		process.env.API_PUBLISH_ADDR = "127.0.0.1:3800";
		expect(allowsAnonymousRead()).toBe(true);
	});

	test("a publish spec that names no loopback host keeps reads closed", () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "127.0.0.1";
		for (const spec of [
			"0.0.0.0:3800",
			"3800",
			"garbage",
			"192.168.1.9:3800",
		]) {
			process.env.API_PUBLISH_ADDR = spec;
			expect(allowsAnonymousRead(), spec).toBe(false);
		}
	});

	test("the metered archive keeps its own posture, not the bind's", () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.LISTEN_HOST = "0.0.0.0";
		expect(allowsAnonymousRead()).toBe(true);
		expect(allowsAnonymousRead({ platform: false })).toBe(false);
	});
});

describe("credential errors name the recovery", () => {
	test.each([
		["missing", missingCredentialError()],
		["invalid", invalidCredentialError()],
	])("%s credential points at INSTANCE_TOKEN", (_name, err) => {
		expect(err.code).toBe("AUTHENTICATION_ERROR");
		expect(err.details?.env_var).toBe("INSTANCE_TOKEN");
		expect(String(err.details?.hint)).toContain("secondlayer init");
		expect(String(err.details?.hint)).toContain("loopback");
	});
});

describe("v1InstanceGate", () => {
	const prevMode = process.env.INSTANCE_MODE;
	const prevHost = process.env.LISTEN_HOST;
	const prevToken = process.env.INSTANCE_TOKEN;

	afterEach(() => {
		restoreEnv("INSTANCE_MODE", prevMode);
		restoreEnv("LISTEN_HOST", prevHost);
		restoreEnv("INSTANCE_TOKEN", prevToken);
	});

	function app() {
		const a = new Hono();
		a.onError(errorHandler);
		a.use("/v1/*", v1InstanceGate());
		a.get("/v1/contracts", (c) => c.json({ ok: true }));
		a.get("/v1/index/events", (c) => c.json({ ok: true }));
		return a;
	}

	test("loopback bind: leaf routes with no token store are open", async () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "127.0.0.1";
		expect((await app().request("/v1/contracts")).status).toBe(200);
	});

	test("public bind: a leaf route with no token store needs the instance token", async () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "0.0.0.0";
		process.env.INSTANCE_TOKEN = "abc123";
		const a = app();
		expect((await a.request("/v1/contracts")).status).toBe(401);
		expect(
			(
				await a.request("/v1/contracts", {
					headers: { authorization: "Bearer abc123" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await a.request("/v1/contracts", {
					headers: { authorization: "Bearer wrong" },
				})
			).status,
		).toBe(401);
	});

	test("public bind: planes with their own token store are left to enforce it", async () => {
		process.env.INSTANCE_MODE = "oss";
		process.env.LISTEN_HOST = "0.0.0.0";
		process.env.INSTANCE_TOKEN = "abc123";
		// The gate cannot see first-party service credentials (the internal
		// decoder key), so it must not reject on their behalf.
		expect((await app().request("/v1/index/events")).status).toBe(200);
	});
});
