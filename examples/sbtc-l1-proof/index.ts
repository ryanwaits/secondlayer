// The keystone: index the Stacks side → prove the Bitcoin side → verify on-chain.
//
// For every recent sBTC deposit the Secondlayer index surfaces (each carries the
// `bitcoin_txid` that links it to Bitcoin L1), build the SPV proof and run the
// SIP-044 built-ins against the spv-adapter in Clarinet simnet. Runs today.

import { recentDeposits } from "./deposits.ts";
import { proveDeposit } from "./prove.ts";

const deposits = await recentDeposits();
console.log(
	`Proving ${deposits.length} sBTC deposit(s) against spv-adapter (simnet @ Epoch 4.0)\n`,
);

for (const deposit of deposits) {
	try {
		const r = await proveDeposit(deposit);
		const fee = r.btcOutputSats - r.sbtcMintedSats;
		console.log(
			`${r.included ? "✓" : "✗"} ${r.bitcoinTxid}:${r.vout}\n` +
				`    included:  ${r.included}  (verify-merkle-proof, on-chain)\n` +
				`    btc out:   ${r.btcOutputSats} sats → ${r.recipient ?? "(non-standard)"}\n` +
				`    sbtc mint: ${r.sbtcMintedSats} sats  (fee ${fee} sats)\n`,
		);
	} catch (err) {
		console.log(
			`✗ ${deposit.bitcoinTxid}:${deposit.vout} — ${(err as Error).message}\n`,
		);
	}
}
