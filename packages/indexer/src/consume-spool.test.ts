import { afterEach, describe, expect, test } from "bun:test";
import { isOssIndexer } from "./consume-spool.ts";

describe("oss indexer spool gate", () => {
	const prev = process.env.INSTANCE_MODE;

	afterEach(() => {
		if (prev === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prev;
	});

	test("hosted (unset) is not oss", () => {
		delete process.env.INSTANCE_MODE;
		expect(isOssIndexer()).toBe(false);
	});

	test("explicit oss is oss", () => {
		process.env.INSTANCE_MODE = "oss";
		expect(isOssIndexer()).toBe(true);
	});
});
