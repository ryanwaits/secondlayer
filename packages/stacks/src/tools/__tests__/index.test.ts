import { describe, expect, test } from "bun:test";
import type { StacksReadClient } from "../client.ts";
import { createStacksTools } from "../index.ts";

const VALID_TX_HEX =
	"0000000001040015c31b8c1c11c515e244b75806bac48d1399c775000000000000000000000000000000c80001376b144a5cde3d40bc7f4fb61a53d1568de5b34b58d9308d7c26ecdd48a6bee3087b1aadac3d95fd785413ecf956720131d717805fe6416c5b240458a26b2144030200000000000516a46ff88886c2ef9762d970b4d2c63678835bd39d00000000000003e800000000000000000000000000000000000000000000000000000000000000000000";

function mockClient(response: unknown): StacksReadClient {
	return { request: async () => response } as unknown as StacksReadClient;
}

describe("estimateFee tool", () => {
	test("happy path with valid hex (no 0x prefix)", async () => {
		const tools = createStacksTools(
			mockClient({
				estimations: [
					{ fee_rate: 1, fee: 100 },
					{ fee_rate: 2, fee: 200 },
					{ fee_rate: 3, fee: 300 },
				],
			}),
		);
		const result = await tools.estimateFee.execute({
			serializedTxHex: VALID_TX_HEX,
		});
		expect(result).toEqual({ low: 100, medium: 200, high: 300 });
	});

	test("happy path with valid hex (0x prefix)", async () => {
		const tools = createStacksTools(
			mockClient({
				estimations: [{ fee_rate: 5, fee: 500 }],
			}),
		);
		const result = await tools.estimateFee.execute({
			serializedTxHex: `0x${VALID_TX_HEX}`,
		});
		expect(result).toEqual({ low: 500, medium: 0, high: 0 });
	});

	test("odd-length hex throws a clear message", async () => {
		const tools = createStacksTools(mockClient({}));
		await expect(
			tools.estimateFee.execute({ serializedTxHex: "0xabc" }),
		).rejects.toThrow("serializedTxHex: odd-length hex string");
	});

	test("non-hex characters throw a clear message", async () => {
		const tools = createStacksTools(mockClient({}));
		await expect(
			tools.estimateFee.execute({ serializedTxHex: "0xgg12" }),
		).rejects.toThrow("serializedTxHex: contains non-hex characters");
	});

	test("valid hex but invalid tx structure throws a wrapped message", async () => {
		const tools = createStacksTools(mockClient({}));
		await expect(
			tools.estimateFee.execute({ serializedTxHex: "0xabcd" }),
		).rejects.toThrow("serializedTxHex: deserialization failed");
	});
});
