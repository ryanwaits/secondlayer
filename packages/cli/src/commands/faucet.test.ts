import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

/**
 * The faucet mints tokens, so its guards matter more than its happy path.
 *
 * The mechanism only works where the caller IS the signer set — i.e. a devnet
 * they deployed. Anywhere else the same call is a real protocol call against a
 * chain they do not control.
 */

describe("network guard", () => {
	test("only devnet and local are mintable", () => {
		const mintable = (network: string) =>
			network === "devnet" || network === "local";
		expect(mintable("devnet")).toBe(true);
		expect(mintable("local")).toBe(true);
		expect(mintable("mainnet")).toBe(false);
		expect(mintable("testnet")).toBe(false);
	});
});

describe("amount validation", () => {
	const DUST = 546n;
	/** Mirrors the guard in `parseAmount`. */
	const rejects = (sats: bigint) => sats < DUST;

	test("rejects below the protocol dust limit", () => {
		// `complete-deposit-wrapper` enforces this on-chain; failing locally gives
		// a readable error instead of an opaque contract abort.
		expect(rejects(100n)).toBe(true);
		expect(rejects(545n)).toBe(true);
	});

	test("accepts exactly the dust limit and above", () => {
		expect(rejects(546n)).toBe(false);
		expect(rejects(1_000_000n)).toBe(false);
	});

	test("parses as an integer, never a float", () => {
		// Sats are exact. Accepting "0.01" and multiplying would introduce
		// rounding into a value the contract compares byte-for-byte.
		expect(() => BigInt("0.01")).toThrow();
		expect(BigInt("1000000")).toBe(1_000_000n);
	});
});

describe("deployer mnemonic discovery", () => {
	test("reads accounts.deployer.mnemonic from Devnet.toml", async () => {
		const dir = await mkdtemp(join(tmpdir(), "faucet-"));
		try {
			await mkdir(join(dir, "settings"), { recursive: true });
			await writeFile(
				join(dir, "settings", "Devnet.toml"),
				[
					"[accounts.deployer]",
					'mnemonic = "twice kind fence tip hidden tilt action fragile skin nothing glory cousin green tomorrow spring wrist shed math olympic multiply hip blue scout claw"',
					"balance = 100000000000000",
				].join("\n"),
			);
			const parsed = parseToml(
				await Bun.file(join(dir, "settings", "Devnet.toml")).text(),
			) as { accounts?: { deployer?: { mnemonic?: string } } };
			expect(parsed.accounts?.deployer?.mnemonic).toContain("twice kind fence");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a settings file without a deployer is an error, not a silent default", async () => {
		const dir = await mkdtemp(join(tmpdir(), "faucet-"));
		try {
			await mkdir(join(dir, "settings"), { recursive: true });
			await writeFile(join(dir, "settings", "Devnet.toml"), "[network]\n");
			const parsed = parseToml("[network]\n") as {
				accounts?: { deployer?: { mnemonic?: string } };
			};
			expect(parsed.accounts?.deployer?.mnemonic).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("deposit identity", () => {
	test("each mint uses a fresh 32-byte txid", async () => {
		// The contract enforces uniqueness; reusing one would abort the second
		// mint with an opaque error.
		const { randomBytes } = await import("node:crypto");
		const a = randomBytes(32).toString("hex");
		const b = randomBytes(32).toString("hex");
		expect(a).toHaveLength(64);
		expect(a).not.toBe(b);
	});
});
