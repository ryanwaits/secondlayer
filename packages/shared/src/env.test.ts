import { describe, expect, test } from "bun:test";
import {
	isBnsDecoderEnabled,
	isPox4DecoderEnabled,
	isPox5DecoderEnabled,
	isSbtcDecoderEnabled,
} from "./env.ts";

describe("decoder enable flags", () => {
	test("sbtc/pox default ON; only the string false opts out", () => {
		expect(isSbtcDecoderEnabled({})).toBe(true);
		expect(isPox4DecoderEnabled({})).toBe(true);
		expect(isPox5DecoderEnabled({})).toBe(true);
		expect(isSbtcDecoderEnabled({ SBTC_DECODER_ENABLED: "false" })).toBe(false);
		expect(isPox4DecoderEnabled({ POX4_DECODER_ENABLED: "yes" })).toBe(true);
	});

	test("bns defaults OFF; only the string true opts in", () => {
		expect(isBnsDecoderEnabled({})).toBe(false);
		expect(isBnsDecoderEnabled({ BNS_DECODER_ENABLED: "true" })).toBe(true);
		expect(isBnsDecoderEnabled({ BNS_DECODER_ENABLED: "TRUE" })).toBe(false);
	});
});
