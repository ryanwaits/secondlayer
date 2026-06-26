// T3 — the on-chain half, in Clarinet simnet.
//
// Clarinet >= 3.21 boots simnet at Epoch 4.0, so the SIP-044 Bitcoin built-ins
// execute locally — no node, no devnet. This wires the repo's `spv-adapter`
// reference contract and exposes a single `callRO(method, args)` helper.
//
// The bridge: @secondlayer/stacks owns its Clarity codec, clarinet-sdk speaks
// @stacks/transactions. We round-trip through `serializeCV` so the bytes the SDK
// produces are exactly what the built-ins receive — that round-trip IS the test.

import { resolve } from "node:path";
import {
	buildMerkleProof,
	encodeMerkleProofArgs,
	merkleRoot,
	reverseBytes,
} from "@secondlayer/stacks/bitcoin";
import {
	type ClarityValue,
	deserializeCV,
	serializeCV,
} from "@secondlayer/stacks/clarity";
import { hexToBytes } from "@secondlayer/stacks/utils";
import { type Simnet, initSimnet } from "@stacks/clarinet-sdk";
import { Cl, type ClarityValue as StacksCV } from "@stacks/transactions";

const MANIFEST = resolve(import.meta.dir, "../../contracts/Clarinet.toml");
const CONTRACT = "spv-adapter";

const toChain = (cv: ClarityValue): StacksCV => Cl.deserialize(serializeCV(cv));
const fromChain = (cv: StacksCV): ClarityValue =>
	deserializeCV(Cl.serialize(cv));

let cached: { simnet: Simnet; deployer: string } | null = null;

async function getSimnet(): Promise<{ simnet: Simnet; deployer: string }> {
	if (!cached) {
		const simnet = await initSimnet(MANIFEST);
		const deployer = simnet.getAccounts().get("deployer") as string;
		cached = { simnet, deployer };
	}
	return cached;
}

/** Call a read-only `spv-adapter` function with SDK-encoded args. */
export async function callRO(
	method: string,
	args: ClarityValue[],
): Promise<ClarityValue> {
	const { simnet, deployer } = await getSimnet();
	const result = simnet.callReadOnlyFn(
		CONTRACT,
		method,
		args.map(toChain),
		deployer,
	);
	return fromChain(result.result);
}

if (import.meta.main) {
	// Deterministic smoke: Block 170 (Satoshi → Hal Finney), tx index 0 → true.
	const internal = (display: string) => reverseBytes(hexToBytes(display));
	const txids = [
		internal(
			"b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082",
		),
		internal(
			"f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
		),
	];
	const root = merkleRoot(txids);
	const proof = buildMerkleProof(txids, 0);
	const args = encodeMerkleProofArgs({
		leaf: txids[0] as Uint8Array,
		root,
		proof,
	});
	const result = await callRO("verify-merkle", args);
	console.log("simnet epoch 4.0 · verify-merkle (block 170):", result.type);
}
