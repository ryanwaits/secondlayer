import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { computeSignerGrantHash } from "../../pox5/grants.ts";
import { encodeStructuredData, structuredDataHash } from "../structuredData.ts";
import { Cl } from "../values.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));

describe("SIP-018 structured data", () => {
	it("matches pox-5 grant hashing", () => {
		const opts = {
			signerManager: `${ACCOUNT.address}.signer-mgr`,
			authId: 1n,
			chainId: 1,
		};
		const domain = Cl.tuple({
			name: Cl.stringAscii("pox-5-signer"),
			version: Cl.stringAscii("1.0.0"),
			"chain-id": Cl.uint(opts.chainId),
		});
		const message = Cl.tuple({
			topic: Cl.stringAscii("grant-authorization"),
			"signer-manager": Cl.principal(opts.signerManager),
			"auth-id": Cl.uint(opts.authId),
		});
		expect(structuredDataHash({ domain, message })).toEqual(
			computeSignerGrantHash(opts),
		);
		expect(encodeStructuredData({ domain, message }).length).toBe(6 + 32 + 32);
	});

	it("rejects a domain missing chain-id", () => {
		expect(() =>
			encodeStructuredData({
				domain: Cl.tuple({
					name: Cl.stringAscii("app"),
					version: Cl.stringAscii("1"),
				}),
				message: Cl.uint(1),
			}),
		).toThrow(/domain must be a tuple/);
	});
});
