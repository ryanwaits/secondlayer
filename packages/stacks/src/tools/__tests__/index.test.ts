import { describe, expect, test } from "bun:test";
import type { ToolCallOptions } from "ai";
import type { z } from "zod";
import { Cl } from "../../clarity/index.ts";
import { serializeCV } from "../../clarity/serialize.ts";
import type { StacksReadClient } from "../client.ts";
import { createStacksTools, getStxBalance } from "../index.ts";

/**
 * The AI SDK types `Tool.execute` as optional and two-argument
 * `(input, options)`. Every tool under test defines it, so assert that once
 * here instead of at each call site, and supply the options bag the signature
 * requires.
 */
const TOOL_CALL_OPTIONS: ToolCallOptions = {
	toolCallId: "test-tool-call",
	messages: [],
};

async function runTool<Input, Output>(
	tool: {
		execute?: (
			input: Input,
			options: ToolCallOptions,
		) => AsyncIterable<Output> | PromiseLike<Output> | Output;
	},
	input: Input,
): Promise<Output | AsyncIterable<Output>> {
	if (!tool.execute) throw new Error("tool has no execute");
	return await tool.execute(input, TOOL_CALL_OPTIONS);
}

const VALID_TX_HEX =
	"0000000001040015c31b8c1c11c515e244b75806bac48d1399c775000000000000000000000000000000c80001376b144a5cde3d40bc7f4fb61a53d1568de5b34b58d9308d7c26ecdd48a6bee3087b1aadac3d95fd785413ecf956720131d717805fe6416c5b240458a26b2144030200000000000516a46ff88886c2ef9762d970b4d2c63678835bd39d00000000000003e800000000000000000000000000000000000000000000000000000000000000000000";

const PRINCIPAL = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";

function mockClient(response: unknown): StacksReadClient {
	return {
		request: async () => response,
		chain: { network: "mainnet" },
	} as unknown as StacksReadClient;
}

/** Client that records every request path, so a test can prove no request was made. */
function recordingClient(response: unknown): {
	client: StacksReadClient;
	paths: string[];
} {
	const paths: string[] = [];
	const client = {
		request: async (path: string) => {
			paths.push(path);
			return response;
		},
		chain: { network: "mainnet" },
	} as unknown as StacksReadClient;
	return { client, paths };
}

function parseInput(tool: { inputSchema: unknown }, input: unknown) {
	return (tool.inputSchema as z.ZodType).safeParse(input);
}

/**
 * The AI SDK gate: validate against `inputSchema`, call `execute` only when
 * validation passes. Returns whether the call reached `execute`.
 */
async function runValidated(
	tool: {
		inputSchema: unknown;
		execute?: (input: unknown, options: ToolCallOptions) => unknown;
	},
	input: unknown,
): Promise<boolean> {
	const parsed = parseInput(tool, input);
	if (!parsed.success) return false;
	if (!tool.execute) throw new Error("tool has no execute");
	await tool.execute(parsed.data, TOOL_CALL_OPTIONS);
	return true;
}

describe("getStxBalance", () => {
	test("returns microStx balance", async () => {
		const tools = createStacksTools(mockClient({ balance: "1000" }));
		const result = await runTool(tools.getStxBalance, { principal: PRINCIPAL });
		expect(result).toEqual({ microStx: "1000" });
	});
});

describe("getAccountInfo", () => {
	test("returns balance and nonce", async () => {
		const tools = createStacksTools(
			mockClient({ balance: "5000", nonce: "3" }),
		);
		const result = await runTool(tools.getAccountInfo, {
			principal: PRINCIPAL,
		});
		expect(result).toEqual({ balance: "5000", nonce: "3" });
	});
});

describe("getBlock", () => {
	test("returns block by height", async () => {
		const block = { hash: "0xabc", height: 123 };
		const tools = createStacksTools(mockClient(block));
		const result = await runTool(tools.getBlock, { height: 123 });
		expect(result).toEqual(block);
	});

	test("latest block is unwrapped to the same single-block shape as a height lookup", async () => {
		const block = { hash: "0xdef", height: 999 };
		const tools = createStacksTools(mockClient({ results: [block] }));
		const result = await runTool(tools.getBlock, {});
		expect(result).toEqual(block);
	});

	test("rejects a hash that is not 32 bytes of hex before any request", () => {
		const tools = createStacksTools(mockClient({}));
		expect(parseInput(tools.getBlock, { hash: "../v2/info" }).success).toBe(
			false,
		);
		expect(
			parseInput(tools.getBlock, { hash: `0x${"ab".repeat(32)}` }).success,
		).toBe(true);
	});
});

describe("getBlockHeight", () => {
	test("returns current height", async () => {
		const tools = createStacksTools(mockClient({ stacks_tip_height: 150000 }));
		const result = await runTool(tools.getBlockHeight, {});
		expect(result).toEqual({ height: 150000 });
	});
});

describe("readContract", () => {
	test("returns the decoded value as JSON", async () => {
		const tools = createStacksTools(mockClient({ okay: true, result: "0x03" }));
		const result = await runTool(tools.readContract, {
			contract: `${PRINCIPAL}.contract`,
			functionName: "is-active",
		});
		expect(result).toEqual({ result: { type: "bool", value: true } });
	});

	test("a uint result serializes as a decimal string instead of crashing on bigint", async () => {
		const tools = createStacksTools(
			mockClient({ okay: true, result: serializeCV(Cl.uint(42n)) }),
		);
		const result = (await runTool(tools.readContract, {
			contract: `${PRINCIPAL}.pox-4`,
			functionName: "get-stacking-minimum",
		})) as { result: { type: string; value: string } };
		expect(result.result).toEqual({ type: "uint", value: "42" });
		expect(() => JSON.stringify(result)).not.toThrow();
	});

	test("a tuple containing uints round-trips through JSON", async () => {
		const tools = createStacksTools(
			mockClient({
				okay: true,
				result: serializeCV(
					Cl.ok(Cl.tuple({ total: Cl.uint(1000n), cycle: Cl.uint(7n) })),
				),
			}),
		);
		const result = await runTool(tools.readContract, {
			contract: `${PRINCIPAL}.pool`,
			functionName: "get-totals",
		});
		expect(JSON.parse(JSON.stringify(result))).toEqual({
			result: {
				type: "(response)",
				success: true,
				value: {
					type: "(tuple)",
					value: {
						total: { type: "uint", value: "1000" },
						cycle: { type: "uint", value: "7" },
					},
				},
			},
		});
	});

	test("rejects a contract id or function name that would leave the call-read route", () => {
		const tools = createStacksTools(mockClient({}));
		expect(
			parseInput(tools.readContract, {
				contract: `${PRINCIPAL}.contract/../../v2/info`,
				functionName: "f",
			}).success,
		).toBe(false);
		expect(
			parseInput(tools.readContract, {
				contract: `${PRINCIPAL}.contract`,
				functionName: "f#x",
			}).success,
		).toBe(false);
		expect(
			parseInput(tools.readContract, {
				contract: `${PRINCIPAL}.contract`,
				functionName: "get-balance",
			}).success,
		).toBe(true);
	});
});

describe("estimateFee", () => {
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
		const result = await runTool(tools.estimateFee, {
			serializedTxHex: VALID_TX_HEX,
		});
		expect(result).toEqual({
			low: 100,
			medium: 200,
			high: 300,
			source: "node",
			tiers: 3,
		});
	});

	test("no node estimate falls back to the relay minimum and says so", async () => {
		const tools = createStacksTools(mockClient({ estimations: [] }));
		const result = await runTool(tools.estimateFee, {
			serializedTxHex: VALID_TX_HEX,
		});
		const min = VALID_TX_HEX.length / 2;
		expect(result).toEqual({
			low: min,
			medium: min,
			high: min,
			source: "min",
			tiers: 0,
		});
	});

	test("a single node estimate (0x-prefixed input) fills every tier instead of reporting zero fees, and tiers says only one was live", async () => {
		const tools = createStacksTools(
			mockClient({
				estimations: [{ fee_rate: 5, fee: 500 }],
			}),
		);
		const result = await runTool(tools.estimateFee, {
			serializedTxHex: `0x${VALID_TX_HEX}`,
		});
		expect(result).toEqual({
			low: 500,
			medium: 500,
			high: 500,
			source: "node",
			tiers: 1,
		});
	});

	test("odd-length hex throws a clear message", async () => {
		const tools = createStacksTools(mockClient({}));
		await expect(
			runTool(tools.estimateFee, { serializedTxHex: "0xabc" }),
		).rejects.toThrow("serializedTxHex: odd-length hex string");
	});

	test("non-hex characters throw a clear message", async () => {
		const tools = createStacksTools(mockClient({}));
		await expect(
			runTool(tools.estimateFee, { serializedTxHex: "0xgg12" }),
		).rejects.toThrow("serializedTxHex: contains non-hex characters");
	});

	test("valid hex but invalid tx structure throws a wrapped message", async () => {
		const tools = createStacksTools(mockClient({}));
		await expect(
			runTool(tools.estimateFee, { serializedTxHex: "0xabcd" }),
		).rejects.toThrow("serializedTxHex: deserialization failed");
	});
});

describe("bnsResolve", () => {
	test("returns owner principal", async () => {
		const tools = createStacksTools(
			mockClient({
				okay: true,
				result: "0x070a0516aeef80ca848789cacbd8499f07655adf5570636a",
			}),
		);
		const result = await runTool(tools.bnsResolve, { name: "test.btc" });
		expect(result).toEqual({ owner: PRINCIPAL });
	});
});

describe("bnsReverse", () => {
	test("returns primary name", async () => {
		const tools = createStacksTools(
			mockClient({
				okay: true,
				result:
					"0x070a0c00000002046e616d650200000005616c696365096e616d6573706163650200000003627463",
			}),
		);
		const result = await runTool(tools.bnsReverse, { principal: PRINCIPAL });
		expect(result).toEqual({ name: "alice.btc" });
	});
});

describe("getTransaction", () => {
	test("returns transaction receipt", async () => {
		const tx = {
			tx_status: "success",
			block_height: 100,
			block_hash: "0xabc",
			events: [],
		};
		const tools = createStacksTools(mockClient(tx));
		const result = await runTool(tools.getTransaction, {
			txId: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		});
		expect(result).toMatchObject({
			txid: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
			status: "success",
			blockHeight: 100,
			events: [],
		});
	});

	test("a uint transaction result serializes as JSON instead of leaking a bigint", async () => {
		const tx = {
			tx_status: "success",
			block_height: 100,
			block_hash: "0xabc",
			tx_result: { hex: serializeCV(Cl.ok(Cl.uint(1000n))) },
			events: [],
		};
		const tools = createStacksTools(mockClient(tx));
		const result = await runTool(tools.getTransaction, {
			txId: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		});
		expect(() => JSON.stringify(result)).not.toThrow();
		expect(result).toMatchObject({
			result: {
				type: "(response)",
				success: true,
				value: { type: "uint", value: "1000" },
			},
		});
	});

	test("rejects a txId that is not a 32-byte hex string before any request", () => {
		const tools = createStacksTools(mockClient({}));
		expect(
			parseInput(tools.getTransaction, { txId: "../v2/info" }).success,
		).toBe(false);
		expect(parseInput(tools.getTransaction, { txId: "0xabc" }).success).toBe(
			false,
		);
	});
});

describe("principal inputs", () => {
	test("a path-shaped principal is rejected by the schema, so the validate-then-execute gate never fetches it", async () => {
		const { client, paths } = recordingClient({ balance: "1" });
		const tools = createStacksTools(client);
		for (const t of [
			tools.getStxBalance,
			tools.getAccountInfo,
			tools.bnsReverse,
			tools.getAccountHistory,
			tools.getNftHoldings,
		]) {
			expect(await runValidated(t, { principal: "../v2/info" })).toBe(false);
		}
		expect(paths).toEqual([]);
		expect(
			await runValidated(tools.getStxBalance, { principal: PRINCIPAL }),
		).toBe(true);
		expect(
			await runValidated(tools.getStxBalance, {
				principal: `${PRINCIPAL}.pox-4`,
			}),
		).toBe(true);
		expect(paths).toHaveLength(2);
	});

	test("the action boundary percent-encodes a function name so a Clarity-legal slash cannot add path segments", async () => {
		const { client, paths } = recordingClient({ okay: true, result: "0x03" });
		const tools = createStacksTools(client);
		await runTool(tools.readContract, {
			contract: `${PRINCIPAL}.contract`,
			functionName: "a/../b",
		});
		expect(paths).toEqual([
			`/v2/contracts/call-read/${PRINCIPAL}/contract/a%2F..%2Fb`,
		]);
	});

	test("the action boundary percent-encodes a principal so it cannot add path segments", async () => {
		const { client, paths } = recordingClient({ balance: "1" });
		const tools = createStacksTools(client);
		await runTool(tools.getStxBalance, { principal: "../v2/info?x=1" });
		expect(paths).toEqual(["/v2/accounts/..%2Fv2%2Finfo%3Fx%3D1"]);
	});
});

describe("bare exports", () => {
	test("share the factory's schemas, so the default client gets the same input validation", () => {
		expect(parseInput(getStxBalance, { principal: "../v2/info" }).success).toBe(
			false,
		);
		expect(parseInput(getStxBalance, { principal: PRINCIPAL }).success).toBe(
			true,
		);
	});
});

describe("getAccountHistory", () => {
	test("returns paginated history", async () => {
		const history = { results: [{ tx_id: "0xabc" }], total: 1 };
		const tools = createStacksTools(mockClient(history));
		const result = await runTool(tools.getAccountHistory, {
			principal: PRINCIPAL,
			limit: 10,
		});
		expect(result).toEqual(history);
	});
});

describe("getMempoolStats", () => {
	test("returns mempool stats", async () => {
		const stats = { pending: 10, fee_distribution: [] };
		const tools = createStacksTools(mockClient(stats));
		const result = await runTool(tools.getMempoolStats, {});
		expect(result).toEqual(stats);
	});
});

describe("getNftHoldings", () => {
	test("returns NFT holdings", async () => {
		const holdings = { results: [{ id: "nft1" }], total: 1 };
		const tools = createStacksTools(mockClient(holdings));
		const result = await runTool(tools.getNftHoldings, {
			principal: PRINCIPAL,
			limit: 10,
		});
		expect(result).toEqual(holdings);
	});
});
