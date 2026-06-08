/**
 * x402 mainnet smoke test — be your own first accountless agent against the live
 * API, paying real micro-amounts. Verifies the whole rail end to end on mainnet.
 *
 * Usage:
 *   1. Generate a throwaway payer wallet (prints address + key):
 *        bun scripts/x402-mainnet-smoke.ts
 *   2. Fund that address with a little sBTC or USDCx (no STX needed — gasless),
 *      then run the paid call:
 *        X402_TEST_KEY=<key> bun scripts/x402-mainnet-smoke.ts
 *
 * Env:
 *   X402_TEST_KEY    payer private key (hex). Absent → generate + print one.
 *   X402_API_BASE    default https://api.secondlayer.tools
 *   X402_TEST_PATH   default /v1/index/events?event_type=ft_transfer&from_height=0
 *
 * Imports the SDK from source so no build/publish is needed; consumers use the
 * published `@secondlayer/sdk` (identical API).
 */
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import {
	X402SpendGuardError,
	readX402Receipt,
	withX402,
} from "../packages/sdk/src/x402.ts";

const API = process.env.X402_API_BASE ?? "https://api.secondlayer.tools";
const PATH =
	process.env.X402_TEST_PATH ??
	"/v1/index/events?event_type=ft_transfer&from_height=0";
const KEY = process.env.X402_TEST_KEY;
const ADDRESS_VERSION = 22; // mainnet single-sig (SP...)

function generateKey(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	// 33-byte compressed private key (`01` suffix).
	return `${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}01`;
}

async function main(): Promise<void> {
	if (!KEY) {
		const key = generateKey();
		const account = privateKeyToAccount(key, {
			addressVersion: ADDRESS_VERSION,
		});
		console.log(
			"No X402_TEST_KEY set — generated a throwaway mainnet wallet:\n",
		);
		console.log(`  address: ${account.address}`);
		console.log(`  key:     ${key}`);
		console.log(
			"\nFund the address with a little sBTC or USDCx (a few cents; NO STX needed),",
		);
		console.log(
			"then re-run:\n  X402_TEST_KEY=<key> bun scripts/x402-mainnet-smoke.ts",
		);
		return;
	}

	const account = privateKeyToAccount(KEY, { addressVersion: ADDRESS_VERSION });
	console.log(`payer:  ${account.address}`);
	console.log(`target: ${API}${PATH}\n`);

	const x402fetch = withX402(fetch, {
		account,
		preferAssets: ["sBTC", "USDCx", "STX"],
		// Generous caps (atomic units) — a $0.001 call is far below these; the guard
		// only trips on a wildly mispriced offer.
		maxAmountPerCall: { sBTC: 100_000n, USDCx: 1_000_000n, STX: 100_000_000n },
		onSettling: (i) =>
			console.log(`  settling: paying ${i.amount} (${i.asset}) …`),
	});

	const started = Date.now();
	let res: Response;
	try {
		res = await x402fetch(`${API}${PATH}`);
	} catch (err) {
		if (err instanceof X402SpendGuardError) {
			console.error(`❌ spend guard tripped: ${err.message}`);
			process.exit(1);
		}
		throw err;
	}
	const elapsedMs = Date.now() - started;

	console.log(`\nstatus: ${res.status}  (${elapsedMs}ms incl. pay + settle)`);
	if (res.status !== 200) {
		console.error("body:", (await res.text()).slice(0, 400));
		process.exit(1);
	}

	const receipt = readX402Receipt(res);
	const body = (await res.json()) as { events?: unknown[] };
	console.log("receipt:", receipt);
	console.log(
		"data:   ",
		body.events ? `${body.events.length} event(s)` : body,
	);

	if (!receipt?.txid) {
		console.error(
			"❌ 200 but no PAYMENT-RESPONSE receipt — not a paid response",
		);
		process.exit(1);
	}

	console.log("\n✅ pay-per-call works on mainnet.");
	console.log(
		`   tx: https://explorer.hiro.so/txid/${receipt.txid}?chain=mainnet`,
	);
	console.log("   verify on-chain:");
	console.log("     • payer balance ↓ by the offer amount (no gas)");
	console.log("     • sponsor wallet STX ↓ by the network fee");
	console.log("     • X402_PAY_TO ↑ by the offer amount");
	console.log(
		`     • x402_payments ledger row for ${receipt.txid}: ${receipt.state} → confirmed (after the reconciler runs)`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
