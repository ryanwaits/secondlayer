import { describe, expect, it } from "bun:test";
import {
	cvToBigInt,
	cvToBoolean,
	cvToBuffer,
	cvToPrincipal,
	cvToString,
} from "../prettyPrint.ts";
import { Cl } from "../values.ts";

describe("cvToBigInt", () => {
	it("narrows int to bigint", () => {
		expect(cvToBigInt(Cl.int(1))).toBe(1n);
	});

	it("narrows uint to bigint", () => {
		expect(cvToBigInt(Cl.uint(1))).toBe(1n);
	});

	it("throws on bool", () => {
		expect(() => cvToBigInt(Cl.bool(true))).toThrow(
			"cvToBigInt: expected int or uint, got true",
		);
	});
});

describe("cvToString", () => {
	it("narrows ascii to string", () => {
		expect(cvToString(Cl.stringAscii("hello"))).toBe("hello");
	});

	it("narrows utf8 to string", () => {
		expect(cvToString(Cl.stringUtf8("héllo"))).toBe("héllo");
	});

	it("throws on uint", () => {
		expect(() => cvToString(Cl.uint(1))).toThrow(
			"cvToString: expected ascii or utf8, got uint",
		);
	});
});

describe("cvToBuffer", () => {
	it("narrows buffer to hex string", () => {
		expect(cvToBuffer(Cl.bufferFromHex("0xabcd"))).toBe("abcd");
	});

	it("throws on ascii", () => {
		expect(() => cvToBuffer(Cl.stringAscii("hello"))).toThrow(
			"cvToBuffer: expected buffer, got ascii",
		);
	});
});

describe("cvToBoolean", () => {
	it("narrows true to boolean", () => {
		expect(cvToBoolean(Cl.bool(true))).toBe(true);
	});

	it("narrows false to boolean", () => {
		expect(cvToBoolean(Cl.bool(false))).toBe(false);
	});

	it("throws on int", () => {
		expect(() => cvToBoolean(Cl.int(1))).toThrow(
			"cvToBoolean: expected bool, got int",
		);
	});
});

describe("cvToPrincipal", () => {
	it("narrows standard principal to string", () => {
		const addr = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
		expect(cvToPrincipal(Cl.principal(addr))).toBe(addr);
	});

	it("narrows contract principal to string", () => {
		const addr = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-contract";
		expect(cvToPrincipal(Cl.principal(addr))).toBe(addr);
	});

	it("throws on buffer", () => {
		expect(() => cvToPrincipal(Cl.bufferFromHex("0xabcd"))).toThrow(
			"cvToPrincipal: expected principal or contract, got buffer",
		);
	});
});
