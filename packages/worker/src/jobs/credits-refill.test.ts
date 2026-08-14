import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { startCreditsRefillCron } from "./credits-refill.ts";

describe("credits refill cron", () => {
	let prev: string | undefined;

	beforeEach(() => {
		prev = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "oss";
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prev;
	});

	test("does not schedule in oss mode", () => {
		const stop = startCreditsRefillCron();
		stop();
		expect(typeof stop).toBe("function");
	});
});
