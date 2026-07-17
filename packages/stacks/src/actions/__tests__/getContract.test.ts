import { describe, expect, it } from "bun:test";
import { expectTypeOf } from "expect-type";
import type { AbiContract } from "../../clarity/abi/contract.ts";
import type {
	AbiTypesOf,
	ExtractFunctionArgs,
	ExtractFunctionOutput,
	TypedAbi,
} from "../../clarity/abi/index.ts";
import { Cl } from "../../clarity/values.ts";
import type { Client } from "../../clients/types.ts";
import { buildContractCall } from "../../transactions/build.ts";
import { serializeTransaction } from "../../transactions/wire/serialize.ts";
import { bytesToHex } from "../../utils/encoding.ts";
import { ContractResponseError, getContract } from "../getContract.ts";

const TEST_ABI = {
	functions: [
		{
			name: "get-balance",
			access: "read-only",
			args: [{ name: "account", type: "principal" }],
			outputs: { response: { ok: "uint128", error: "uint128" } },
		},
		{
			name: "get-name",
			access: "read-only",
			args: [],
			outputs: {
				response: { ok: { "string-ascii": { length: 32 } }, error: "uint128" },
			},
		},
		{
			name: "transfer",
			access: "public",
			args: [
				{ name: "amount", type: "uint128" },
				{ name: "sender", type: "principal" },
				{ name: "recipient", type: "principal" },
				{ name: "memo", type: { optional: { buff: { length: 34 } } } },
			],
			outputs: { response: { ok: "bool", error: "uint128" } },
		},
	],
	maps: [{ name: "token-balances", key: "principal", value: "uint128" }],
} as const satisfies AbiContract;

function createMockClient(
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	requestHandler: (path: string, init?: any) => Promise<any>,
): Client {
	return {
		transport: {
			type: "custom" as const,
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			config: {} as any,
			request: async () => ({}),
		},
		request: requestHandler,
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		extend: () => ({}) as any,
	};
}

describe("getContract", () => {
	describe("type inference", () => {
		it("should infer read method argument types", () => {
			type GetBalanceArgs = ExtractFunctionArgs<typeof TEST_ABI, "get-balance">;
			expectTypeOf<GetBalanceArgs>().toEqualTypeOf<{ account: string }>();
		});

		it("should infer read method output types (response unwrapped)", () => {
			type GetBalanceOutput = ExtractFunctionOutput<
				typeof TEST_ABI,
				"get-balance"
			>;
			expectTypeOf<GetBalanceOutput>().toEqualTypeOf<
				{ ok: bigint } | { err: bigint }
			>();
		});

		it("should infer transfer args", () => {
			type TransferArgs = ExtractFunctionArgs<typeof TEST_ABI, "transfer">;
			expectTypeOf<TransferArgs>().toEqualTypeOf<{
				amount: bigint;
				sender: string;
				recipient: string;
				memo: Uint8Array | null;
			}>();
		});
	});

	describe("read methods", () => {
		it("should call readContract and auto-unwrap ok response", async () => {
			const mockClient = createMockClient(async (_path, _init) => {
				// readContract POST returns { okay: true, result: hex }
				return {
					okay: true,
					result: Cl.serialize(Cl.ok(Cl.uint(1000n))),
				};
			});

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			const balance = await contract.read.getBalance({
				account: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			});

			expect(balance).toBe(1000n);
		});

		it("should throw ContractResponseError on err response", async () => {
			const mockClient = createMockClient(async () => ({
				okay: true,
				result: Cl.serialize(Cl.error(Cl.uint(1n))),
			}));

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			expect(
				contract.read.getBalance({
					account: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				}),
			).rejects.toThrow(ContractResponseError);
		});

		it("should handle no-arg read-only functions", async () => {
			const mockClient = createMockClient(async () => ({
				okay: true,
				result: Cl.serialize(Cl.ok(Cl.stringAscii("TestToken"))),
			}));

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			const name = await contract.read.getName({});
			expect(name).toBe("TestToken");
		});
	});

	describe("map methods", () => {
		it("should return value for existing map entry", async () => {
			const mockClient = createMockClient(async () => ({
				data: Cl.serialize(Cl.some(Cl.uint(500n))),
			}));

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			const balance = await contract.maps.tokenBalances(
				"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			);
			expect(balance).toBe(500n);
		});

		it("should return null for missing map entry", async () => {
			const mockClient = createMockClient(async () => ({
				data: Cl.serialize(Cl.none()),
			}));

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			const balance = await contract.maps.tokenBalances(
				"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			);
			expect(balance).toBeNull();
		});
	});

	describe("buildCall methods", () => {
		const PUBKEY =
			"02e3af144cc2a3f8f3f7be8f6e3a951c2f4ce9dcd1f26e279c7f8bbcf9e2b6e2d5";

		it("builds an unsigned contract-call transaction without broadcasting", async () => {
			let requested = false;
			const mockClient = createMockClient(async () => {
				requested = true;
				return {};
			});

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			const tx = await contract.buildCall.transfer(
				{
					amount: 100n,
					sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
					recipient: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
					memo: null,
				},
				{ publicKey: PUBKEY, fee: 200n, nonce: 7n },
			);

			expect(tx.payload.payloadType).toBe(2); // PayloadType.ContractCall
			// biome-ignore lint/suspicious/noExplicitAny: asserting on wire payload shape
			const payload = tx.payload as any;
			expect(payload.functionName).toBe("transfer");
			expect(payload.contractName).toBe("my-token");
			expect(payload.functionArgs).toHaveLength(4);
			expect(tx.auth.spendingCondition.nonce).toBe(7n);
			expect(tx.auth.spendingCondition.fee).toBe(200n);
			// explicit fee + nonce → no network calls, nothing broadcast
			expect(requested).toBe(false);
		});

		it("fee estimation invalidates the cached serialization (ST-011 regression)", async () => {
			const mockClient = createMockClient(async () => ({
				estimations: [
					{ fee_rate: 1, fee: 100 },
					{ fee_rate: 2, fee: 250 },
					{ fee_rate: 3, fee: 900 },
				],
			}));

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			// no fee → estimateFee serializes the tx (fee=0) before the fee is
			// set in place; that mutation must invalidate the memoized bytes
			const tx = await contract.buildCall.transfer(
				{
					amount: 100n,
					sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
					recipient: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
					memo: null,
				},
				{ publicKey: PUBKEY, nonce: 7n },
			);

			expect(tx.auth.spendingCondition.fee).toBe(250n);

			const expected = buildContractCall({
				contractAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				contractName: "my-token",
				functionName: "transfer",
				functionArgs: [
					Cl.uint(100n),
					Cl.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"),
					Cl.principal("SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE"),
					Cl.none(),
				],
				fee: 250n,
				nonce: 7n,
				publicKey: PUBKEY,
			});

			expect(bytesToHex(serializeTransaction(tx))).toBe(
				bytesToHex(serializeTransaction(expected)),
			);
		});

		it("throws without a publicKey or client account", async () => {
			const contract = getContract({
				client: createMockClient(async () => ({})),
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			expect(
				contract.buildCall.transfer(
					{
						amount: 100n,
						sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
						recipient: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
						memo: null,
					},
					{ fee: 200n, nonce: 7n },
				),
			).rejects.toThrow("buildCall requires a publicKey");
		});

		it("exposes only public functions", () => {
			const contract = getContract({
				client: createMockClient(async () => ({})),
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: TEST_ABI,
			});

			// biome-ignore lint/suspicious/noExplicitAny: probing runtime proxy behavior
			expect((contract.buildCall as any).getBalance).toBeUndefined();
			expect(contract.buildCall.transfer).toBeInstanceOf(Function);
		});
	});

	describe("branded ABI (TypedAbi)", () => {
		type GetBalanceArgs = { account: string };
		type GetBalanceResult = { ok: bigint } | { err: bigint };
		type TransferArgs = {
			amount: bigint;
			sender: string;
			recipient: string;
			memo: Uint8Array | null;
		};
		type TransferResult = { ok: boolean } | { err: bigint };

		type TestTypes = {
			functions: {
				getBalance: {
					args: GetBalanceArgs;
					ret: GetBalanceResult;
					access: "read-only";
				};
				getName: {
					args: Record<string, never>;
					ret: { ok: string } | { err: bigint };
					access: "read-only";
				};
				transfer: {
					args: TransferArgs;
					ret: TransferResult;
					access: "public";
				};
			};
			maps: {
				tokenBalances: { key: string; value: bigint };
			};
		};

		const BRANDED_ABI = TEST_ABI as TypedAbi<typeof TEST_ABI, TestTypes>;

		it("resolves the brand for branded ABIs and never for plain ones", () => {
			expectTypeOf<AbiTypesOf<typeof BRANDED_ABI>>().toEqualTypeOf<TestTypes>();
			expectTypeOf<AbiTypesOf<typeof TEST_ABI>>().toBeNever();
		});

		it("surfaces branded named types on read/call/maps methods", () => {
			const contract = getContract({
				client: createMockClient(async () => ({})),
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: BRANDED_ABI,
			});

			expectTypeOf(contract.read.getBalance)
				.parameter(0)
				.toEqualTypeOf<GetBalanceArgs>();
			expectTypeOf(contract.read.getBalance).returns.toEqualTypeOf<
				Promise<bigint>
			>();
			expectTypeOf(contract.call.transfer)
				.parameter(0)
				.toEqualTypeOf<TransferArgs>();
			expectTypeOf(contract.maps.tokenBalances).returns.toEqualTypeOf<
				Promise<bigint | null>
			>();
			expectTypeOf(contract.buildCall.transfer)
				.parameter(0)
				.toEqualTypeOf<TransferArgs>();

			// public fn absent from read, read-only absent from call
			expectTypeOf<keyof typeof contract.read>().toEqualTypeOf<
				"getBalance" | "getName"
			>();
			expectTypeOf<keyof typeof contract.call>().toEqualTypeOf<"transfer">();
		});

		it("runtime behavior is identical for branded ABIs (brand is phantom)", async () => {
			const mockClient = createMockClient(async () => ({
				okay: true,
				result: Cl.serialize(Cl.ok(Cl.uint(1000n))),
			}));

			const contract = getContract({
				client: mockClient,
				address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				name: "my-token",
				abi: BRANDED_ABI,
			});

			const balance = await contract.read.getBalance({
				account: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			});
			expect(balance).toBe(1000n);
		});
	});
});
