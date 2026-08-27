import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isExtendedViewEnabled, resolveExtendedPort } from "./listen.ts";

describe("extended listen helpers", () => {
	let prevView: string | undefined;
	let prevPort: string | undefined;

	beforeEach(() => {
		prevView = process.env.EXTENDED_VIEW;
		prevPort = process.env.EXTENDED_PORT;
		delete process.env.EXTENDED_VIEW;
		delete process.env.EXTENDED_PORT;
	});

	afterEach(() => {
		if (prevView === undefined) delete process.env.EXTENDED_VIEW;
		else process.env.EXTENDED_VIEW = prevView;
		if (prevPort === undefined) delete process.env.EXTENDED_PORT;
		else process.env.EXTENDED_PORT = prevPort;
	});

	test('isExtendedViewEnabled is true only for EXACTLY "1"', () => {
		expect(isExtendedViewEnabled()).toBe(false);
		process.env.EXTENDED_VIEW = "1";
		expect(isExtendedViewEnabled()).toBe(true);
		process.env.EXTENDED_VIEW = "true";
		expect(isExtendedViewEnabled()).toBe(false);
		process.env.EXTENDED_VIEW = "0";
		expect(isExtendedViewEnabled()).toBe(false);
	});

	test("resolveExtendedPort defaults to 3999", () => {
		expect(resolveExtendedPort()).toBe(3999);
	});

	test("resolveExtendedPort parses EXTENDED_PORT", () => {
		process.env.EXTENDED_PORT = "4001";
		expect(resolveExtendedPort()).toBe(4001);
	});

	test("resolveExtendedPort throws on bad values", () => {
		process.env.EXTENDED_PORT = "nope";
		expect(() => resolveExtendedPort()).toThrow(
			/EXTENDED_PORT must be a positive integer/,
		);
		process.env.EXTENDED_PORT = "0";
		expect(() => resolveExtendedPort()).toThrow(
			/EXTENDED_PORT must be a positive integer/,
		);
		process.env.EXTENDED_PORT = "-1";
		expect(() => resolveExtendedPort()).toThrow(
			/EXTENDED_PORT must be a positive integer/,
		);
	});
});
