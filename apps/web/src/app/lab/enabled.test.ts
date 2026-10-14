import { describe, expect, test } from "bun:test";
import { labEnabled } from "./enabled";

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe("labEnabled", () => {
	test("local dev renders the lab", () => {
		expect(labEnabled(env({ NODE_ENV: "development" }))).toBe(true);
	});

	test("a Vercel preview deploy renders the lab", () => {
		expect(
			labEnabled(env({ NODE_ENV: "production", VERCEL_ENV: "preview" })),
		).toBe(true);
	});

	test("a Vercel production deploy does not", () => {
		expect(
			labEnabled(env({ NODE_ENV: "production", VERCEL_ENV: "production" })),
		).toBe(false);
	});

	test("a self-host production build, with no VERCEL_ENV, does not", () => {
		expect(labEnabled(env({ NODE_ENV: "production" }))).toBe(false);
	});

	test("the test environment does not", () => {
		expect(labEnabled(env({ NODE_ENV: "test" }))).toBe(false);
	});
});
