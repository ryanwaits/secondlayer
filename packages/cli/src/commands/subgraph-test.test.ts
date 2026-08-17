import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type IndexReadContext, indexReadFailure } from "./subgraph-test.ts";

const ctx: IndexReadContext = {
	source: "names",
	fromHeight: 1,
	toHeight: 101,
	apiUrl: "http://127.0.0.1:3800",
	file: "subgraphs/bns-names.ts",
};

describe("indexReadFailure", () => {
	const savedToken = process.env.INSTANCE_TOKEN;
	const savedLegacy = process.env.SL_API_KEY;

	beforeEach(() => {
		process.env.INSTANCE_TOKEN = undefined;
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
	});

	afterEach(() => {
		if (savedToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = savedToken;
		if (savedLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = savedLegacy;
	});

	test("a rejected read names the endpoint and the range instead of a stack trace", () => {
		const { message } = indexReadFailure({ status: 401 }, ctx);
		expect(message).toBe(
			'Index read rejected (HTTP 401) while reading source "names" (blocks 1–101) from http://127.0.0.1:3800.',
		);
		expect(message).not.toContain("packages/sdk");
	});

	test("a rejected read reports whether a credential is even set rather than declaring it invalid", () => {
		const withoutToken = indexReadFailure({ status: 401 }, ctx).hint ?? "";
		expect(withoutToken).toContain("no INSTANCE_TOKEN is set in this shell");
		expect(withoutToken).not.toContain("invalid");

		process.env.INSTANCE_TOKEN = "tok";
		const withToken = indexReadFailure({ status: 403 }, ctx).hint ?? "";
		expect(withToken).toContain("INSTANCE_TOKEN is set in this shell");
		expect(withToken).toContain("subgraphs deploy");
	});

	test("a rejected read offers the offline replay as an escape hatch", () => {
		const { hint } = indexReadFailure({ status: 401 }, ctx);
		expect(hint).toContain(
			"secondlayer subgraphs test subgraphs/bns-names.ts --offline",
		);
	});

	test("a metered-window refusal keeps the seekable-height guidance", () => {
		const { message, hint } = indexReadFailure(
			{ status: 402, body: { details: { oldest_seekable_height: 8_000_000 } } },
			ctx,
		);
		expect(message).toContain("below the free read window");
		expect(hint).toContain("--from 8000000");
	});

	test("a wrong endpoint is named as such on 404", () => {
		const { hint } = indexReadFailure({ status: 404 }, ctx);
		expect(hint).toContain("not a Stacks node");
	});

	test("a server error tells the reader to check the instance, not the credential", () => {
		const { message, hint } = indexReadFailure({ status: 503 }, ctx);
		expect(message).toContain("HTTP 503");
		expect(hint).toContain("secondlayer status");
	});

	test("an unrecognized failure still carries its detail and a next command", () => {
		const { message, hint } = indexReadFailure(
			new Error("fetch failed: ECONNREFUSED"),
			ctx,
		);
		expect(message).toContain("ECONNREFUSED");
		expect(message).toContain("http://127.0.0.1:3800");
		expect(hint).toContain("secondlayer status");
	});
});
