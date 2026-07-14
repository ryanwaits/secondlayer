import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import {
	addressToVersion,
	getContractAddress,
	isAddressEqual,
	isValidAddress,
	publicKeyToAddress,
	validateStacksAddress,
} from "../address.ts";
import { AddressVersion } from "../constants.ts";

describe("isValidAddress", () => {
	test("alias for validateStacksAddress", () => {
		expect(isValidAddress).toBe(validateStacksAddress);
	});

	test("valid mainnet addresses", () => {
		expect(isValidAddress("SP000000000000000000002Q6VF78")).toBe(true);
		expect(isValidAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(
			true,
		);
	});

	test("valid testnet addresses", () => {
		expect(isValidAddress("ST000000000000000000002AMW42H")).toBe(true);
	});

	test("invalid addresses", () => {
		expect(isValidAddress("")).toBe(false);
		expect(isValidAddress("not-an-address")).toBe(false);
		expect(isValidAddress("SP")).toBe(false);
	});
});

describe("isAddressEqual", () => {
	test("same address is equal", () => {
		const addr = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
		expect(isAddressEqual(addr, addr)).toBe(true);
	});

	test("different addresses are not equal", () => {
		expect(
			isAddressEqual(
				"SP000000000000000000002Q6VF78",
				"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			),
		).toBe(false);
	});

	test("mainnet vs testnet zero address not equal", () => {
		expect(
			isAddressEqual(
				"SP000000000000000000002Q6VF78",
				"ST000000000000000000002AMW42H",
			),
		).toBe(false);
	});

	test("throws on invalid address", () => {
		expect(() =>
			isAddressEqual("invalid", "SP000000000000000000002Q6VF78"),
		).toThrow();
	});
});

describe("addressToVersion", () => {
	test("mainnet single-sig", () => {
		expect(addressToVersion("SP000000000000000000002Q6VF78")).toBe(
			AddressVersion.MainnetSingleSig,
		);
	});

	test("testnet single-sig", () => {
		expect(addressToVersion("ST000000000000000000002AMW42H")).toBe(
			AddressVersion.TestnetSingleSig,
		);
	});
});

describe("getContractAddress", () => {
	test("valid deployer and name", () => {
		expect(
			getContractAddress(
				"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
				"my-contract",
			),
		).toBe("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-contract");
	});

	test("throws on invalid deployer", () => {
		expect(() => getContractAddress("invalid", "my-contract")).toThrow(
			"Invalid deployer",
		);
	});

	test("throws on invalid contract name", () => {
		expect(() =>
			getContractAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7", ""),
		).toThrow("Invalid contract name");
	});

	test("throws on contract name starting with number", () => {
		expect(() =>
			getContractAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7", "1bad"),
		).toThrow("Invalid contract name");
	});
});

describe("publicKeyToAddress", () => {
	// Cross-check against privateKeyToAccount, which derives the same way
	const account = privateKeyToAccount(
		"0000000000000000000000000000000000000000000000000000000000000001",
	);

	test("derives the mainnet single-sig address of a compressed key", () => {
		expect(publicKeyToAddress(account.publicKey)).toBe(account.address);
		expect(addressToVersion(publicKeyToAddress(account.publicKey))).toBe(
			AddressVersion.MainnetSingleSig,
		);
	});

	test("derives testnet addresses with the testnet version byte", () => {
		const testnet = publicKeyToAddress(account.publicKey, "testnet");
		expect(addressToVersion(testnet)).toBe(AddressVersion.TestnetSingleSig);
		expect(testnet).not.toBe(account.address);
	});
});
