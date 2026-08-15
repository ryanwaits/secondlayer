import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { commerceGatesEnabled } from "./deploy-auth.ts";

describe("commerceGatesEnabled", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
	});

	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("OSS has no paid-deploy expiry or ghost gates", () => {
		process.env.INSTANCE_MODE = "oss";
		expect(commerceGatesEnabled()).toBe(false);
	});

	test("platform keeps the x402 paid-deploy expiry gate", () => {
		process.env.INSTANCE_MODE = "platform";
		expect(commerceGatesEnabled()).toBe(true);
	});
});
