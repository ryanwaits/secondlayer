import { describe, expect, test } from "bun:test";
import {
	isBnsDecoderEnabled,
	isPox4DecoderEnabled,
	isPox5DecoderEnabled,
	isSbtcDecoderEnabled,
	stacksNetwork,
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

describe("stacksNetwork", () => {
	test("STACKS_NETWORK wins over the deprecated NETWORK", () => {
		expect(
			stacksNetwork({ STACKS_NETWORK: "testnet", NETWORK: "mainnet" }),
		).toBe("testnet");
	});

	test("a deployment that only sets NETWORK keeps its network", () => {
		expect(stacksNetwork({ NETWORK: "testnet" })).toBe("testnet");
	});

	test("defaults to mainnet", () => {
		expect(stacksNetwork({})).toBe("mainnet");
	});
});
