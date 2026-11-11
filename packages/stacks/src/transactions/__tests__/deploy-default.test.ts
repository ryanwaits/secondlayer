import { describe, expect, test } from "bun:test";
import { buildContractDeploy } from "../build.ts";
import { ClarityVersion, PayloadType } from "../types.ts";
import { deserializeTransaction } from "../wire/deserialize.ts";
import { serializeTransactionHex } from "../wire/serialize.ts";

const base = {
	contractName: "token",
	codeBody: "(define-constant x u1)",
	fee: 1n,
	nonce: 0n,
	publicKey: `02${"11".repeat(32)}`,
};

describe("contract deploy defaults", () => {
	test("a deploy with no clarityVersion uses the unversioned payload every epoch accepts", () => {
		const tx = buildContractDeploy(base);
		expect(tx.payload.payloadType).toBe(PayloadType.SmartContract);
		expect("clarityVersion" in tx.payload).toBe(false);
	});

	test("an unversioned deploy survives serialize and deserialize unchanged", () => {
		const tx = buildContractDeploy(base);
		const decoded = deserializeTransaction(serializeTransactionHex(tx));
		expect(decoded.payload.payloadType).toBe(PayloadType.SmartContract);
		expect(decoded.payload).toMatchObject({
			contractName: base.contractName,
			codeBody: base.codeBody,
		});
		expect("clarityVersion" in decoded.payload).toBe(false);
	});

	test("a deploy that names a clarityVersion still sends the versioned payload", () => {
		const tx = buildContractDeploy({
			...base,
			clarityVersion: ClarityVersion.Clarity6,
		});
		expect(tx.payload.payloadType).toBe(PayloadType.VersionedSmartContract);
		expect((tx.payload as { clarityVersion?: number }).clarityVersion).toBe(6);
	});
});
