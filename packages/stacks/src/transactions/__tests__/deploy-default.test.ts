import { describe, expect, test } from "bun:test";
import { buildContractDeploy } from "../build.ts";
import { ClarityVersion, PayloadType } from "../types.ts";

describe("contract deploy defaults", () => {
	test("omitted clarityVersion emits a versioned Clarity4 payload", () => {
		const tx = buildContractDeploy({
			contractName: "token",
			codeBody: "(define-constant x u1)",
			fee: 1n,
			nonce: 0n,
			publicKey: `02${"11".repeat(32)}`,
		});
		expect(tx.payload.payloadType).toBe(PayloadType.VersionedSmartContract);
		expect((tx.payload as { clarityVersion?: number }).clarityVersion).toBe(
			ClarityVersion.Clarity4,
		);
	});
});
