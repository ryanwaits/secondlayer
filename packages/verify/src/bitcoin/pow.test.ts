import { describe, expect, test } from "bun:test";
import {
	POW_LIMIT,
	POW_LIMIT_BITS,
	TARGET_TIMESPAN,
	bitsToTarget,
	checkProofOfWork,
	decodeCompact,
	headerWork,
	nextRetargetBits,
	targetToBits,
} from "./pow.ts";

describe("compact bits", () => {
	test("powLimit round-trips", () => {
		expect(bitsToTarget(POW_LIMIT_BITS)).toBe(POW_LIMIT);
		expect(targetToBits(POW_LIMIT)).toBe(POW_LIMIT_BITS);
	});

	test("encoding avoids the sign bit by growing the exponent", () => {
		expect(targetToBits(0x80n)).toBe(0x02008000);
		expect(bitsToTarget(0x02008000)).toBe(0x80n);
	});

	test("matches Core's SetCompact vectors", () => {
		expect(decodeCompact(0x01123456).target).toBe(0x12n);
		expect(decodeCompact(0x04923456).negative).toBe(true);
		expect(decodeCompact(0xff123456).overflow).toBe(true);
		expect(targetToBits(0x12n)).toBe(0x01120000);
		expect(targetToBits(0x12345600n)).toBe(0x04123456);
	});

	test("invalid targets throw", () => {
		expect(() => bitsToTarget(0)).toThrow(RangeError);
		expect(() => bitsToTarget(0x04923456)).toThrow(RangeError);
	});
});

describe("proof of work", () => {
	test("targets above powLimit never pass", () => {
		expect(checkProofOfWork(new Uint8Array(32), 0x1d01ffff)).toBe(false);
		expect(checkProofOfWork(new Uint8Array(32), POW_LIMIT_BITS)).toBe(true);
	});

	test("genesis-difficulty work is 2^32 + 2^16 + 1", () => {
		expect(headerWork(POW_LIMIT_BITS)).toBe(0x100010001n);
	});

	test("retarget clamps to 4x and never exceeds powLimit", () => {
		const bits = 0x1b0404cb;
		const target = bitsToTarget(bits);
		expect(nextRetargetBits(bits, 0, TARGET_TIMESPAN * 100)).toBe(
			targetToBits(target * 4n),
		);
		expect(nextRetargetBits(bits, 0, 1)).toBe(targetToBits(target / 4n));
		expect(nextRetargetBits(POW_LIMIT_BITS, 0, TARGET_TIMESPAN * 4)).toBe(
			POW_LIMIT_BITS,
		);
	});
});
