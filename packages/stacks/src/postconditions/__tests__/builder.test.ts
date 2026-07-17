import { describe, expect, test } from "bun:test";
import { Cl } from "../../clarity/values.ts";
import { Pc } from "../builder.ts";

const ADDR = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const CONTRACT_ID = `${ADDR}.my-token`;
const NFT_CONTRACT_ID = `${ADDR}.my-nft`;

describe("Pc stx post-conditions", () => {
	test("willSendEq → ustx", () => {
		const pc = Pc.principal(ADDR).willSendEq(1000n).ustx();
		expect(pc).toEqual({
			type: "stx-postcondition",
			address: ADDR,
			condition: "eq",
			amount: "1000",
		});
	});

	test("willSendGte → ustx", () => {
		const pc = Pc.principal(ADDR).willSendGte(1000n).ustx();
		expect(pc).toEqual({
			type: "stx-postcondition",
			address: ADDR,
			condition: "gte",
			amount: "1000",
		});
	});

	test("willSendGt → ustx", () => {
		const pc = Pc.principal(ADDR).willSendGt(1000n).ustx();
		expect(pc).toEqual({
			type: "stx-postcondition",
			address: ADDR,
			condition: "gt",
			amount: "1000",
		});
	});

	test("willSendLte → ustx", () => {
		const pc = Pc.principal(ADDR).willSendLte(1000n).ustx();
		expect(pc).toEqual({
			type: "stx-postcondition",
			address: ADDR,
			condition: "lte",
			amount: "1000",
		});
	});

	test("willSendLt → ustx", () => {
		const pc = Pc.principal(ADDR).willSendLt(1000n).ustx();
		expect(pc).toEqual({
			type: "stx-postcondition",
			address: ADDR,
			condition: "lt",
			amount: "1000",
		});
	});

	test("origin principal → willSendGte → ustx", () => {
		const pc = Pc.origin().willSendGte(500n).ustx();
		expect(pc).toEqual({
			type: "stx-postcondition",
			address: "origin",
			condition: "gte",
			amount: "500",
		});
	});

	test("contract principal → willSendEq → ustx", () => {
		const pc = Pc.principal(`${ADDR}.signer-manager`).willSendEq(0n).ustx();
		expect(pc).toEqual({
			type: "stx-postcondition",
			address: `${ADDR}.signer-manager`,
			condition: "eq",
			amount: "0",
		});
	});
});

describe("Pc ft post-conditions", () => {
	test("willSendEq → ft", () => {
		const pc = Pc.principal(ADDR).willSendEq(1000n).ft(CONTRACT_ID, "my-token");
		expect(pc).toEqual({
			type: "ft-postcondition",
			address: ADDR,
			condition: "eq",
			amount: "1000",
			asset: `${CONTRACT_ID}::my-token`,
		});
	});

	test("willSendGte → ft", () => {
		const pc = Pc.principal(ADDR)
			.willSendGte(1000n)
			.ft(CONTRACT_ID, "my-token");
		expect(pc).toEqual({
			type: "ft-postcondition",
			address: ADDR,
			condition: "gte",
			amount: "1000",
			asset: `${CONTRACT_ID}::my-token`,
		});
	});

	test("willSendGt → ft", () => {
		const pc = Pc.principal(ADDR).willSendGt(1000n).ft(CONTRACT_ID, "my-token");
		expect(pc).toEqual({
			type: "ft-postcondition",
			address: ADDR,
			condition: "gt",
			amount: "1000",
			asset: `${CONTRACT_ID}::my-token`,
		});
	});

	test("willSendLte → ft", () => {
		const pc = Pc.principal(ADDR)
			.willSendLte(1000n)
			.ft(CONTRACT_ID, "my-token");
		expect(pc).toEqual({
			type: "ft-postcondition",
			address: ADDR,
			condition: "lte",
			amount: "1000",
			asset: `${CONTRACT_ID}::my-token`,
		});
	});

	test("willSendLt → ft", () => {
		const pc = Pc.principal(ADDR).willSendLt(1000n).ft(CONTRACT_ID, "my-token");
		expect(pc).toEqual({
			type: "ft-postcondition",
			address: ADDR,
			condition: "lt",
			amount: "1000",
			asset: `${CONTRACT_ID}::my-token`,
		});
	});
});

describe("Pc nft post-conditions", () => {
	test("willSendAsset → nft (3-arg form)", () => {
		const pc = Pc.principal(ADDR)
			.willSendAsset()
			.nft(NFT_CONTRACT_ID, "my-nft", Cl.uint(1));
		expect(pc).toEqual({
			type: "nft-postcondition",
			address: ADDR,
			condition: "sent",
			asset: `${NFT_CONTRACT_ID}::my-nft`,
			assetId: { type: "uint", value: 1n },
		});
	});

	test("willNotSendAsset → nft (3-arg form)", () => {
		const pc = Pc.principal(ADDR)
			.willNotSendAsset()
			.nft(NFT_CONTRACT_ID, "my-nft", Cl.uint(42));
		expect(pc).toEqual({
			type: "nft-postcondition",
			address: ADDR,
			condition: "not-sent",
			asset: `${NFT_CONTRACT_ID}::my-nft`,
			assetId: { type: "uint", value: 42n },
		});
	});

	test("willSendAsset → nft (2-arg string form)", () => {
		const pc = Pc.principal(ADDR)
			.willSendAsset()
			.nft(`${NFT_CONTRACT_ID}::my-nft`, Cl.uint(1));
		expect(pc).toEqual({
			type: "nft-postcondition",
			address: ADDR,
			condition: "sent",
			asset: `${NFT_CONTRACT_ID}::my-nft`,
			assetId: { type: "uint", value: 1n },
		});
	});

	test("willNotSendAsset → nft (2-arg string form)", () => {
		const pc = Pc.origin()
			.willNotSendAsset()
			.nft(`${NFT_CONTRACT_ID}::my-nft`, Cl.uint(99));
		expect(pc).toEqual({
			type: "nft-postcondition",
			address: "origin",
			condition: "not-sent",
			asset: `${NFT_CONTRACT_ID}::my-nft`,
			assetId: { type: "uint", value: 99n },
		});
	});
});

describe("Pc validation errors", () => {
	test("principal rejects invalid address", () => {
		expect(() => Pc.principal("invalid")).toThrow(/Invalid principal/);
	});

	test("ft rejects invalid contract id", () => {
		expect(() =>
			Pc.principal(ADDR).willSendEq(1n).ft("invalid", "token"),
		).toThrow(/Invalid contract id/);
	});

	test("nft rejects invalid asset string (2-arg)", () => {
		expect(() =>
			Pc.principal(ADDR).willSendAsset().nft("invalid", Cl.uint(1)),
		).toThrow(/Invalid asset name/);
	});

	test("nft rejects invalid contract id (3-arg)", () => {
		expect(() =>
			Pc.principal(ADDR)
				.willSendAsset()
				.nft("invalid.contract", "token", Cl.uint(1)),
		).toThrow(/Invalid contract address/);
	});
});
