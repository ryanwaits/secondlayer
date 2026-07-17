import { describe, expect, test } from "bun:test";
import type { StacksReadClient } from "../client.ts";
import { createStacksTools } from "../index.ts";

const VALID_TX_HEX =
	"0000000001040015c31b8c1c11c515e244b75806bac48d1399c775000000000000000000000000000000c80001376b144a5cde3d40bc7f4fb61a53d1568de5b34b58d9308d7c26ecdd48a6bee3087b1aadac3d95fd785413ecf956720131d717805fe6416c5b240458a26b2144030200000000000516a46ff88886c2ef9762d970b4d2c63678835bd39d00000000000003e800000000000000000000000000000000000000000000000000000000000000000000";

const PRINCIPAL = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";

function mockClient(response: unknown): StacksReadClient {
	return {
		request: async () => response,
		chain: { network: "mainnet" },
	} as unknown as StacksReadClient;
}

describe("getStxBalance", () => {
	test("returns microStx balance", async () => {
		const tools = createStacksTools(mockClient({ balance: "1000" }));
		const result = await tools.getStxBalance.execute({ principal: PRINCIPAL });
		expect(result).toEqual({ microStx: "1000" });
	});
});

describe("getAccountInfo", () => {
	test("returns balance and nonce", async () => {
		const tools = createStacksTools(
			mockClient({ balance: "5000", nonce: "3" }),
		);
		const result = await tools.getAccountInfo.execute({ principal: PRINCIPAL });
		expect(result).toEqual({ balance: "5000", nonce: "3" });
	});
});

describe("getBlock", () => {
	test("returns block by height", async () => {
		const block = { hash: "0xabc", height: 123 };
		const tools = createStacksTools(mockClient(block));
		const result = await tools.getBlock.execute({ height: 123 });
		expect(result).toEqual(block);
	});

	test("returns latest block when no args", async () => {
		const block = { hash: "0xdef", height: 999 };
		const tools = createStacksTools(mockClient({ results: [block] }));
		const result = await tools.getBlock.execute({});
		expect(result).toEqual({ results: [block] });
	});
});

describe("getBlockHeight", () => {
	test("returns current height", async () => {
		const tools = createStacksTools(mockClient({ stacks_tip_height: 150000 }));
		const result = await tools.getBlockHeight.execute({});
		expect(result).toEqual({ height: 150000 });
	});
});

describe("readContract", () => {
	test("returns JSON stringified result", async () => {
		const tools = createStacksTools(mockClient({ okay: true, result: "0x03" }));
		const result = await tools.readContract.execute({
			contract: `${PRINCIPAL}.contract`,
			functionName: "is-active",
		});
		expect(result).toEqual({ result: '{"type":"true"}' });
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

describe("bnsResolve", () => {
	test("returns owner principal", async () => {
		const tools = createStacksTools(
			mockClient({
				okay: true,
				result: "0x070a0516aeef80ca848789cacbd8499f07655adf5570636a",
			}),
		);
		const result = await tools.bnsResolve.execute({ name: "test.btc" });
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
		const result = await tools.bnsReverse.execute({ principal: PRINCIPAL });
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
		const result = await tools.getTransaction.execute({
			txId: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		});
		expect(result).toMatchObject({
			txid: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
			status: "success",
			blockHeight: 100,
			events: [],
		});
	});
});

describe("getAccountHistory", () => {
	test("returns paginated history", async () => {
		const history = { results: [{ tx_id: "0xabc" }], total: 1 };
		const tools = createStacksTools(mockClient(history));
		const result = await tools.getAccountHistory.execute({
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
		const result = await tools.getMempoolStats.execute({});
		expect(result).toEqual(stats);
	});
});

describe("getNftHoldings", () => {
	test("returns NFT holdings", async () => {
		const holdings = { results: [{ id: "nft1" }], total: 1 };
		const tools = createStacksTools(mockClient(holdings));
		const result = await tools.getNftHoldings.execute({
			principal: PRINCIPAL,
			limit: 10,
		});
		expect(result).toEqual(holdings);
	});
});
