import { privateKeyToAccount } from "../../packages/stacks/src/accounts/privateKeyToAccount.ts";
/**
 * st-013 spike PoC: can `getContract` (TypedAbi-less, as-const ABI literal)
 * replace pox5's raw callContract/readContract packing?
 *
 * Run:   bun spike/pox5-getContract/poc.ts
 * Check: bunx tsc --noEmit --strict --skipLibCheck --target esnext
 *          --module esnext --moduleResolution bundler
 *          --allowImportingTsExtensions spike/pox5-getContract/poc.ts
 */
import { getContract } from "../../packages/stacks/src/actions/getContract.ts";
import { mainnet } from "../../packages/stacks/src/chains/definitions.ts";
import { serializeCVBytes } from "../../packages/stacks/src/clarity/serialize.ts";
import { Cl } from "../../packages/stacks/src/clarity/values.ts";
import { createWalletClient } from "../../packages/stacks/src/clients/createWalletClient.ts";
import { stake } from "../../packages/stacks/src/pox5/actions.ts";
import type { ContractCallPayload } from "../../packages/stacks/src/transactions/types.ts";
import { deserializeTransaction } from "../../packages/stacks/src/transactions/wire/deserialize.ts";
import { custom } from "../../packages/stacks/src/transports/custom.ts";
import {
	bytesToHex,
	hexToBytes,
	with0x,
} from "../../packages/stacks/src/utils/encoding.ts";
import { POX5_ABI } from "./pox5-abi.ts";

const BOOT = "SP000000000000000000002Q6VF78";
const POX5_ID = `${BOOT}.pox-5`;
const ACCOUNT = privateKeyToAccount("11".repeat(32));
const STAKER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const SIGNER_MGR = `${STAKER}.signer-mgr`;

// --- Mock transport: captures broadcasts, answers reads/nonce/fees ----------

const captured: ContractCallPayload[] = [];
const STAKER_INFO = Cl.some(
	Cl.tuple({
		"amount-ustx": Cl.uint(100_000_000_000n),
		"first-reward-cycle": Cl.uint(3n),
		"num-cycles": Cl.uint(12n),
		signer: Cl.principal(STAKER),
	}),
);

// biome-ignore lint/suspicious/noExplicitAny: test transport stub
const request = async (path: string, options?: any) => {
	if (path.includes("/v2/accounts/")) return { nonce: 0 };
	if (path.includes("/v2/fees/"))
		return { estimations: [{ fee_rate: 1, fee: 200 }] };
	if (path.includes("/v2/contracts/call-read/")) {
		return {
			okay: true,
			result: with0x(bytesToHex(serializeCVBytes(STAKER_INFO))),
		};
	}
	if (path.includes("/v2/transactions")) {
		const tx = deserializeTransaction(hexToBytes(options.body.tx));
		captured.push(tx.payload as ContractCallPayload);
		return `0x${"ab".repeat(32)}`;
	}
	throw new Error(`unexpected path ${path}`);
};

const client = createWalletClient({
	chain: mainnet,
	account: ACCOUNT,
	transport: custom({ request }),
});

// --- Step 1 verify: full extracted ABI satisfies getContract ----------------

const pox5 = getContract({
	client,
	address: BOOT,
	name: "pox-5",
	abi: POX5_ABI,
});

// --- Step 2: typed read vs raw read -----------------------------------------

const typed = await pox5.read.getStakerInfo({ staker: STAKER });
console.log(
	"typed read result:",
	JSON.stringify(typed, (_, v) => (typeof v === "bigint" ? `${v}n` : v)),
);

// Compile-time arg checking — these must fail tsc if uncommented:
// pox5.read.getStakerInfo({ wrongArgName: STAKER });
// pox5.read.getStakerInfo({ staker: 123n });

// Auto-camelCase check: get-bond-l1-unlock-height → getBondL1UnlockHeight
type _CamelWorks = typeof pox5.read.getBondL1UnlockHeight;

// --- Step 3: buildCall.stake vs current stake() — byte-identical? -----------

const stakeParams = {
	signerManager: SIGNER_MGR,
	amountUstx: 100_000_000_000n,
	numCycles: 12n,
};

// A) current pox5 path (broadcasts through the capture transport)
await stake(client, { ...stakeParams, startBurnHeight: 960_231n });
const current = captured[0] as ContractCallPayload;

// B) getContract buildCall (unsigned tx, never broadcasts)
const unsigned = await pox5.buildCall.stake({
	...stakeParams,
	startBurnHt: 960_231n, // ABI arg is `start-burn-ht` → camel startBurnHt
	signerCalldata: null, // (optional …) args are REQUIRED in TS — null = none
});
const built = unsigned.payload as ContractCallPayload;

const hexArgs = (p: ContractCallPayload) =>
	p.functionArgs.map((cv) => bytesToHex(serializeCVBytes(cv)));

const same =
	built.functionName === current.functionName &&
	JSON.stringify(hexArgs(built)) === JSON.stringify(hexArgs(current));

console.log("current fn:", current.functionName, "args:", hexArgs(current));
console.log("built   fn:", built.functionName, "args:", hexArgs(built));
console.log("byte-identical payload:", same);
if (!same) throw new Error("payload mismatch");

// --- Step 4: multicall surface ----------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: introspection
console.log("contract instance keys:", Object.keys(pox5 as any));
console.log("has .multicall:", "multicall" in pox5);

console.log("PoC OK");
