import { beforeAll, describe, expect, test } from "bun:test";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { etc } from "@noble/secp256k1";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import type { CustomAccount, ProviderAccount } from "../../accounts/types.ts";
import { devnet, mainnet, testnet } from "../../chains/definitions.ts";
import { custom } from "../../transports/custom.ts";
import {
	alignAccountToChain,
	createWalletClient,
} from "../createWalletClient.ts";

beforeAll(() => {
	etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => {
		const h = hmac.create(sha256, key);
		for (const msg of msgs) h.update(msg);
		return h.digest();
	};
});

const KEY = "11".repeat(32);
const MAINNET_ADDRESS = "SP3Y74M5227FDVHREWPH773F5Y1W1ED8WXY3RAVG4";
const TESTNET_ADDRESS = "ST3Y74M5227FDVHREWPH773F5Y1W1ED8WXXVB0G1S";
const transport = custom({ request: async () => ({}) });

describe("wallet client account chain", () => {
	test("a mainnet-default account on devnet signs from its ST address", () => {
		const client = createWalletClient({
			account: privateKeyToAccount(KEY),
			chain: devnet,
			transport,
		});
		expect(client.account.address).toBe(TESTNET_ADDRESS);
	});

	test("a mainnet client keeps the SP address and the same account object", () => {
		const account = privateKeyToAccount(KEY);
		const client = createWalletClient({ account, chain: mainnet, transport });
		expect(client.account.address).toBe(MAINNET_ADDRESS);
		expect(client.account).toBe(account);
	});

	test("an explicit testnet account on mainnet becomes SP because the chain wins", () => {
		const account = privateKeyToAccount(KEY, { addressVersion: 26 });
		expect(account.address).toBe(TESTNET_ADDRESS);
		const client = createWalletClient({ account, chain: mainnet, transport });
		expect(client.account.address).toBe(MAINNET_ADDRESS);
	});

	test("an account with no chain is left alone", () => {
		const account = privateKeyToAccount(KEY);
		expect(alignAccountToChain(account, undefined)).toBe(account);
	});

	test("provider accounts are never rewritten", () => {
		const { publicKey } = privateKeyToAccount(KEY);
		const account: ProviderAccount = {
			type: "provider",
			address: MAINNET_ADDRESS,
			publicKey,
			provider: { request: async () => ({}) },
		};
		const client = createWalletClient({ account, chain: devnet, transport });
		expect(client.account).toBe(account);
		expect(client.account.address).toBe(MAINNET_ADDRESS);
	});

	test("an address that isn't this key's single-sig is left alone", () => {
		const { publicKey } = privateKeyToAccount(KEY);
		const account: CustomAccount = {
			type: "custom",
			address: "SP000000000000000000002Q6VF78",
			publicKey,
			sign: () => new Uint8Array(65),
		};
		const client = createWalletClient({ account, chain: testnet, transport });
		expect(client.account).toBe(account);
	});

	test("the aligned account still signs the same as the original", () => {
		const original = privateKeyToAccount(KEY);
		const client = createWalletClient({
			account: original,
			chain: devnet,
			transport,
		});
		expect(client.account).not.toBe(original);
		const hash = new Uint8Array(32).fill(7);
		const aligned = client.account;
		if (aligned.type !== "local") throw new Error("expected a local account");
		expect(aligned.sign(hash)).toEqual(original.sign(hash));
	});
});
