import { findX402TokenByAsset } from "@secondlayer/shared/x402";
import type { LocalAccount } from "@secondlayer/stacks/accounts";
import type { StacksChain } from "@secondlayer/stacks/chains";
import {
	serializeTransactionHex,
	signTransactionWithAccount,
} from "@secondlayer/stacks/transactions";
import { buildExactTransfer } from "@secondlayer/stacks/x402";

/**
 * Client helper for the x402 pay-per-request rail. Turns a 402 challenge into a
 * signed `PAYMENT-SIGNATURE` and retries — one call, gasless, accountless. The
 * agent signs origin-only (it never needs STX); the facilitator sponsors the gas.
 */

export type X402Accept = {
	scheme: "exact";
	network: string;
	asset: string;
	/** Atomic units. */
	amount: string;
	payTo: string;
	maxTimeoutSeconds: number;
	extra: { nonce: string };
};

export type X402Challenge = {
	x402Version: number;
	accepts: X402Accept[];
	error?: string;
};

function b64encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/** Read the x402 challenge from a 402 response — prefer the wire header, fall
 *  back to the JSON body. */
export async function readX402Challenge(
	res: Response,
): Promise<X402Challenge | null> {
	const header = res.headers.get("PAYMENT-REQUIRED");
	if (header) {
		try {
			return JSON.parse(
				Buffer.from(header, "base64").toString("utf8"),
			) as X402Challenge;
		} catch {
			// fall through to body
		}
	}
	try {
		return (await res.clone().json()) as X402Challenge;
	} catch {
		return null;
	}
}

export type BuildSignedX402PaymentOptions = {
	challenge: X402Challenge;
	account: LocalAccount;
	/** The payer account's next nonce. */
	accountNonce: bigint | number | string;
	/** Preferred asset string (e.g. an sBTC/USDCx id). Defaults to the first offer. */
	asset?: string;
	chain?: StacksChain;
};

/**
 * Build a signed, base64 `PAYMENT-SIGNATURE` header value for one `accepts[]`
 * entry. Returns the header plus the chosen offer.
 */
export async function buildSignedX402Payment(
	opts: BuildSignedX402PaymentOptions,
): Promise<{ header: string; accept: X402Accept }> {
	const accept = opts.asset
		? opts.challenge.accepts.find((a) => a.asset === opts.asset)
		: opts.challenge.accepts[0];
	if (!accept) {
		throw new Error(
			`No x402 offer${opts.asset ? ` for asset ${opts.asset}` : ""}`,
		);
	}
	const token = findX402TokenByAsset(accept.asset);
	if (!token) throw new Error(`Unknown x402 asset: ${accept.asset}`);

	const asset =
		token.contractId && token.assetName
			? {
					kind: "sip010" as const,
					contractId: token.contractId,
					assetName: token.assetName,
				}
			: { kind: "stx" as const };

	const tx = buildExactTransfer({
		asset,
		amount: BigInt(accept.amount),
		payTo: accept.payTo,
		payer: opts.account.address,
		payerPublicKey: opts.account.publicKey,
		accountNonce: opts.accountNonce,
		nonce: accept.extra.nonce,
		chain: opts.chain,
	});
	const signed = await signTransactionWithAccount(tx, opts.account);

	const header = b64encode({
		x402Version: opts.challenge.x402Version ?? 2,
		scheme: "exact",
		network: accept.network,
		asset: accept.asset,
		payload: { transaction: serializeTransactionHex(signed) },
		extra: { nonce: accept.extra.nonce },
	});
	return { header, accept };
}

/** Caller-supplied fetch that re-runs the request with the given extra headers. */
export type X402FetchFn = (
	extraHeaders: Record<string, string>,
) => Promise<Response>;

export type PayAndRetryOptions = Omit<
	BuildSignedX402PaymentOptions,
	"challenge"
>;

/**
 * Run a request; if it 402s, pay and retry once. The fetch closure receives the
 * `PAYMENT-SIGNATURE` header on the retry.
 *
 * @example
 * const res = await payAndRetry(
 *   (h) => fetch(url, { headers: h }),
 *   { account, accountNonce, asset: SBTC_ASSET },
 * );
 */
export async function payAndRetry(
	doFetch: X402FetchFn,
	opts: PayAndRetryOptions,
): Promise<Response> {
	const first = await doFetch({});
	if (first.status !== 402) return first;
	const challenge = await readX402Challenge(first);
	if (!challenge) return first;
	const { header } = await buildSignedX402Payment({ challenge, ...opts });
	return doFetch({ "PAYMENT-SIGNATURE": header });
}
