// T2 — the Stacks half, from the Secondlayer index.
//
// `/v1/index/sbtc/deposits` is the decoded sBTC peg-in feed: each row already
// carries the `bitcoin_txid` and `output_index` (the funding vout) that link a
// Stacks mint to its Bitcoin L1 transaction. That join key is what makes the
// proof in `prove.ts` possible without re-indexing anything.
//
// Reads are anonymous (no key) but cover the recent ~24h window; a pinned
// historical deposit is the fallback so the demo always has something to prove.

const API = process.env.SL_API_URL ?? "https://api.secondlayer.tools";

export interface Deposit {
	/** Bitcoin funding txid, display order, no `0x`. */
	bitcoinTxid: string;
	/** The output that funded the peg wallet — the vout to prove/decode. */
	vout: number;
	/** sBTC minted, in sats (deposit minus protocol fee). */
	sbtcAmountSats: bigint;
	/** Stacks tx that emitted the mint. */
	stacksTxId: string;
	stacksBlockHeight: number;
}

// A real completed deposit (Bitcoin block 955261, taproot peg output 0 = 12000
// sats; 11753 sBTC minted after the 247-sat fee). Always resolvable on Esplora.
export const PINNED_DEPOSIT: Deposit = {
	bitcoinTxid:
		"93cab74bfa97d47df6e24c313dad0e2436a40138ff2430269fe55510f4d2a4f1",
	vout: 0,
	sbtcAmountSats: 11753n,
	stacksTxId:
		"0xb50d0d4a42cb0b2a5574e1a8806bbe57bf832c2cee4655ad076b942f81ad3d71",
	stacksBlockHeight: 8392372,
};

const strip0x = (s: string): string =>
	(s.startsWith("0x") ? s.slice(2) : s).toLowerCase();

interface DepositRow {
	bitcoin_txid: string;
	output_index: number;
	amount: string;
	tx_id: string;
	block_height: number;
}

/**
 * Recent completed sBTC deposits from the index, newest first. Falls back to a
 * single pinned historical deposit if the live read is empty or fails — so the
 * example is always runnable offline-of-recent-activity.
 */
export async function recentDeposits(limit = 5): Promise<Deposit[]> {
	try {
		const res = await fetch(
			`${API}/v1/index/sbtc/deposits?confirmed=true&limit=${limit}`,
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = (await res.json()) as { deposits?: DepositRow[] };
		const rows = body.deposits ?? [];
		if (rows.length === 0) return [PINNED_DEPOSIT];
		return rows.map((r) => ({
			bitcoinTxid: strip0x(r.bitcoin_txid),
			vout: r.output_index,
			sbtcAmountSats: BigInt(r.amount),
			stacksTxId: r.tx_id,
			stacksBlockHeight: r.block_height,
		}));
	} catch (err) {
		console.warn(
			`index read failed (${(err as Error).message}); using pinned deposit`,
		);
		return [PINNED_DEPOSIT];
	}
}

if (import.meta.main) {
	const deposits = await recentDeposits();
	console.log(`${deposits.length} deposit(s):`);
	for (const d of deposits) {
		console.log(
			`  btc ${d.bitcoinTxid}:${d.vout}  sbtc ${d.sbtcAmountSats} sats  (stacks #${d.stacksBlockHeight})`,
		);
	}
}
