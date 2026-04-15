import { describe, expect, test } from "bun:test";
import { CreateStreamSchema } from "@secondlayer/shared/schemas";
import { generateStreamConfig } from "../src/stream.ts";

describe("generateStreamConfig", () => {
	test("stx_transfer filter with minAmount → validates against server schema", () => {
		const config = generateStreamConfig({
			name: "whale-alerts",
			endpointUrl: "https://example.com/hook",
			filters: [
				{
					type: "stx_transfer",
					minAmount: 1_000_000_000, // 1000 STX in microSTX
				},
			],
		});
		const result = CreateStreamSchema.safeParse(config);
		expect(result.success).toBe(true);
		expect(config.name).toBe("whale-alerts");
		expect(config.filters).toHaveLength(1);
		expect(config.options?.rateLimit).toBe(10);
		expect(config.options?.decodeClarityValues).toBe(true);
	});

	test("ft_transfer filter with assetIdentifier → validates", () => {
		const config = generateStreamConfig({
			name: "sbtc-transfers",
			endpointUrl: "https://hooks.slack.com/services/T000/B000/xxx",
			filters: [
				{
					type: "ft_transfer",
					assetIdentifier:
						"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
				},
			],
		});
		const result = CreateStreamSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	test("nft_mint filter → validates", () => {
		const config = generateStreamConfig({
			name: "punk-mints",
			endpointUrl: "https://example.com/nft-mint",
			filters: [
				{
					type: "nft_mint",
					assetIdentifier: "SP000000000000000000002Q6VF78.bns::names",
				},
			],
		});
		const result = CreateStreamSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	test("contract_call filter → validates", () => {
		const config = generateStreamConfig({
			name: "amm-swaps",
			endpointUrl: "https://example.com/swap",
			filters: [
				{
					type: "contract_call",
					contractId:
						"SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
					functionName: "swap-x-for-y",
				},
			],
		});
		const result = CreateStreamSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	test("print_event filter → validates", () => {
		const config = generateStreamConfig({
			name: "pool-events",
			endpointUrl: "https://example.com/print-event",
			filters: [
				{
					type: "print_event",
					contractId:
						"SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
					topic: "swap",
				},
			],
		});
		const result = CreateStreamSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	test("custom options merge with defaults", () => {
		const config = generateStreamConfig({
			name: "custom-opts",
			endpointUrl: "https://example.com/hook",
			filters: [{ type: "stx_transfer" }],
			options: { rateLimit: 50, includeRawTx: true },
		});
		expect(config.options?.rateLimit).toBe(50);
		expect(config.options?.includeRawTx).toBe(true);
		expect(config.options?.timeoutMs).toBe(10_000); // default preserved
		expect(config.options?.maxRetries).toBe(3);
	});

	test("empty filters throws", () => {
		expect(() =>
			generateStreamConfig({
				name: "bad",
				endpointUrl: "https://example.com",
				filters: [],
			}),
		).toThrow(/at least one filter/i);
	});

	test("missing endpointUrl throws", () => {
		expect(() =>
			generateStreamConfig({
				name: "bad",
				endpointUrl: "",
				filters: [{ type: "stx_transfer" }],
			}),
		).toThrow(/endpointUrl/);
	});

	test("non-http endpointUrl throws", () => {
		expect(() =>
			generateStreamConfig({
				name: "bad",
				endpointUrl: "ftp://example.com",
				filters: [{ type: "stx_transfer" }],
			}),
		).toThrow(/http/);
	});
});
