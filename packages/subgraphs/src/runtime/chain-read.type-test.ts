/**
 * Type-level tests for no-arg chain-read methods. Type-checked by `tsc`
 * (src is included) but never bundled nor run.
 */
import type { AbiContract } from "@secondlayer/stacks/clarity";
import { expectTypeOf } from "expect-type";
import type { ChainReadMethods } from "./chain-read.ts";

const TOKEN_ABI = {
	functions: [
		{
			name: "get-decimals",
			access: "read-only",
			args: [],
			outputs: { response: { ok: "uint128", error: "uint128" } },
		},
		{
			name: "get-balance",
			access: "read-only",
			args: [{ name: "who", type: "principal" }],
			outputs: { response: { ok: "uint128", error: "uint128" } },
		},
	],
} as const satisfies AbiContract;

type Methods = ChainReadMethods<typeof TOKEN_ABI>;

expectTypeOf<Methods["getDecimals"]>().toBeCallableWith();
expectTypeOf<Methods["getDecimals"]>().toBeCallableWith({});
expectTypeOf<Methods["getBalance"]>().toBeCallableWith({
	who: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
});
expectTypeOf<Methods["getBalance"]>()
	.parameter(0)
	.toEqualTypeOf<{ who: string }>();
