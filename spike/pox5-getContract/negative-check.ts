/**
 * st-013 Step 2 negative case: proves the typed surface rejects bad arg
 * names/types at compile time. This file MUST fail tsc; run:
 *   bunx tsc --noEmit --strict --skipLibCheck --target esnext --module esnext \
 *     --moduleResolution bundler --allowImportingTsExtensions \
 *     spike/pox5-getContract/negative-check.ts
 * Expected: 2 errors (TS2353 wrong arg name, TS2322 wrong arg type).
 */
import { getContract } from "../../packages/stacks/src/actions/getContract.ts";
import type { Client } from "../../packages/stacks/src/clients/types.ts";
import { POX5_ABI } from "./pox5-abi.ts";

declare const client: Client;
const pox5 = getContract({
	client,
	address: "SP000000000000000000002Q6VF78",
	name: "pox-5",
	abi: POX5_ABI,
});

// wrong argument name
pox5.read.getStakerInfo({ wrongName: "SP…" });
// wrong argument type (uint arg given a string)
pox5.buildCall.stake({
	signerManager: "SP….signer-mgr",
	amountUstx: "not-a-bignum",
	numCycles: 12n,
	startBurnHt: 960_231n,
	signerCalldata: null,
});
