import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { http, createWalletClient } from "@secondlayer/stacks";
import { mnemonicToAccount } from "@secondlayer/stacks/accounts";
import { devnet } from "@secondlayer/stacks/chains";
import { Cl } from "@secondlayer/stacks/clarity";
import type { Command } from "commander";
import { parse as parseToml } from "smol-toml";
import { findClarinetProject } from "../lib/devnet-config.ts";
import { dim, note, output, printError, success } from "../lib/output.ts";

/**
 * `sl faucet sbtc` — mint mock sBTC on a LOCAL devnet.
 *
 * The trick is that sBTC's `protocol-mint` gates on a same-deployer `.`
 * reference: `sbtc-registry` records whoever deployed it as the signer
 * principal, and `sbtc-deposit.complete-deposit-wrapper` only checks
 * `tx-sender == current-signer-principal`. So on a devnet where YOU deployed
 * the sBTC contract set, you are the signer set, and you can mint freely with
 * a synthetic deposit txid. No Bitcoin, no regtest, no signer coordination.
 *
 * This is deliberately local-only. There is no hosted dispenser, no shared key,
 * and no rate limiter to operate — the developer already controls the chain
 * they are minting on. That keeps the faucet inside the self-hosted product
 * rather than making it a service someone has to run.
 *
 * It refuses any network that is not devnet. The same call shape against
 * mainnet or testnet would be a real protocol call, and a faucet command is not
 * where anyone should discover that.
 */

const DUST_LIMIT_SATS = 546n;
/** 0.01 sBTC — enough to exercise transfers and post-conditions. */
const DEFAULT_AMOUNT_SATS = 1_000_000n;

type DevnetAccounts = {
	accounts?: {
		deployer?: { mnemonic?: string };
	};
};

async function readDeployerMnemonic(projectDir: string): Promise<string> {
	const path = join(projectDir, "settings", "Devnet.toml");
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		throw new Error(`could not read ${path}`);
	}
	const parsed = parseToml(raw) as DevnetAccounts;
	const mnemonic = parsed.accounts?.deployer?.mnemonic;
	if (!mnemonic) {
		throw new Error(`no accounts.deployer.mnemonic in ${path}`);
	}
	return mnemonic;
}

/** Burn height and hash the deposit must reference, read from the node. */
async function readBurnAnchor(
	rpcUrl: string,
): Promise<{ height: number; hash: string }> {
	const info = (await (
		await fetch(`${rpcUrl.replace(/\/$/, "")}/v2/info`, {
			signal: AbortSignal.timeout(10_000),
		})
	).json()) as { burn_block_height?: number };
	const height = info.burn_block_height;
	if (typeof height !== "number") {
		throw new Error("node did not report a burn block height");
	}
	// `complete-deposit-wrapper` asserts the hash matches the height, so this
	// cannot be synthesised the way the deposit txid can.
	const burn = (await (
		await fetch(
			`${rpcUrl.replace(/\/$/, "")}/extended/v2/burn-blocks/${height}`,
			{ signal: AbortSignal.timeout(10_000) },
		)
	).json()) as { burn_block_hash?: string };
	if (!burn.burn_block_hash) {
		throw new Error(`node did not report a hash for burn block ${height}`);
	}
	return { height, hash: burn.burn_block_hash.replace(/^0x/, "") };
}

function parseAmount(value: string | undefined): bigint {
	if (value === undefined) return DEFAULT_AMOUNT_SATS;
	// Accept sats, since that is what the contract takes and what avoids
	// float rounding on a value that must be exact.
	const parsed = BigInt(value);
	if (parsed < DUST_LIMIT_SATS) {
		throw new Error(
			`--amount must be at least ${DUST_LIMIT_SATS} sats (the protocol dust limit), got ${parsed}`,
		);
	}
	return parsed;
}

export function registerFaucetCommand(program: Command): void {
	const faucet = program
		.command("faucet")
		.description("Mint test assets on a local devnet");

	faucet
		.command("sbtc")
		.description("Mint mock sBTC to an address on your local devnet")
		.requiredOption("--to <address>", "recipient Stacks address")
		.option(
			"--amount <sats>",
			`amount in sats (default ${DEFAULT_AMOUNT_SATS}, minimum ${DUST_LIMIT_SATS})`,
		)
		.option(
			"--contract <id>",
			"sBTC deposit contract (default: <deployer>.sbtc-deposit)",
		)
		.option(
			"--rpc-url <url>",
			"devnet node RPC (default http://localhost:3999)",
		)
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ sl faucet sbtc --to ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
  $ sl faucet sbtc --to ST2... --amount 5000000

Requires a devnet running with the sBTC contract set deployed by your
Clarinet deployer — that deployer is the signer set on your own chain, which
is what makes minting possible without Bitcoin.`,
		)
		.action(async (opts) => {
			try {
				const network = process.env.STACKS_NETWORK ?? "devnet";
				// Minting is only possible where we are the signer set. Anywhere
				// else this same call is a real protocol call against a chain we do
				// not control, and it would fail — loudly here is better.
				if (network !== "devnet" && network !== "local") {
					printError(`sl faucet only works on devnet, not ${network}.`, {
						hint: "Mock sBTC is mintable because you deployed the contracts. On testnet or mainnet the signer set is not yours.",
					});
					process.exit(2);
				}

				const rpcUrl = opts.rpcUrl ?? "http://localhost:3999";
				const amount = parseAmount(opts.amount);

				const projectDir = findClarinetProject(process.cwd());
				if (!projectDir) {
					printError("No Clarinet project found.", {
						hint: "Run this from a project containing Clarinet.toml, or pass --contract explicitly.",
					});
					process.exit(2);
				}

				const mnemonic = await readDeployerMnemonic(projectDir);
				const account = mnemonicToAccount(mnemonic, {
					addressVersion: devnet.addressVersion.singleSig,
				});
				const contract = opts.contract ?? `${account.address}.sbtc-deposit`;

				const anchor = await readBurnAnchor(rpcUrl);
				const client = createWalletClient({
					account,
					chain: devnet,
					transport: http(rpcUrl),
				});

				// The deposit txid only has to be unique — there is no Bitcoin
				// transaction behind it, and the contract only enforces uniqueness.
				const depositTxid = randomBytes(32).toString("hex");
				const sweepTxid = randomBytes(32).toString("hex");

				note(`  minting ${amount} sats to ${opts.to}`);
				note(`  via ${contract} as signer ${account.address}`);

				const txid = await client.callContract({
					contract: contract as `${string}.${string}`,
					functionName: "complete-deposit-wrapper",
					functionArgs: [
						Cl.bufferFromHex(depositTxid),
						Cl.uint(0),
						Cl.uint(amount),
						Cl.principal(opts.to),
						Cl.bufferFromHex(anchor.hash),
						Cl.uint(anchor.height),
						Cl.bufferFromHex(sweepTxid),
					],
					// A mint has no sender-side asset movement to constrain.
					postConditionMode: "allow",
				});

				output({
					json: opts.json,
					data: {
						txid,
						recipient: opts.to,
						amount_sats: amount.toString(),
						contract,
						burn_height: anchor.height,
					},
					human: () => {
						success(`Minted ${amount} sats of mock sBTC to ${opts.to}.`);
						note(`  tx ${txid}`);
						console.error(
							dim("  Mock sBTC on your devnet — not the canonical asset."),
						);
					},
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const hint = /ECONNREFUSED|fetch failed/.test(message)
					? "Is your devnet running? Start it with `clarinet devnet start`."
					: /NoSuchContract|does not exist/.test(message)
						? "Deploy the sBTC contract set to your devnet first, or pass --contract."
						: "Check that your Clarinet deployer matches the sBTC contract deployer.";
				printError(message, { hint });
				process.exit(1);
			}
		});
}
