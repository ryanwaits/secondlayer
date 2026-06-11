import {
	type X402TokenSymbol,
	X402_TOKENS,
	findX402TokenByAsset,
} from "@secondlayer/shared/x402";
import type { LocalAccount } from "@secondlayer/stacks/accounts";
import type { StacksChain } from "@secondlayer/stacks/chains";
import {
	serializeTransactionHex,
	signTransactionWithAccount,
} from "@secondlayer/stacks/transactions";
import { buildExactTransfer } from "@secondlayer/stacks/x402";

/**
 * Client for the x402 pay-per-request rail. Turns a 402 challenge into a signed
 * `PAYMENT-SIGNATURE` and retries — gasless (the agent signs origin-only; the
 * facilitator sponsors the STX fee) and accountless (no key/Stripe/session).
 *
 * Three layers:
 *  - `withX402(fetch, opts)` — drop-in fetch that auto-pays on 402.
 *  - `createX402Client(opts)` — `.get/.post` returning `{ data, payment }`.
 *  - `buildSignedX402Payment` / `readX402Challenge` — primitives for custom transports.
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

/** Decoded `PAYMENT-RESPONSE` settlement receipt. */
export type X402Receipt = {
	success: boolean;
	/** Settlement tier: `optimistic` (served on broadcast-accept, reconciled
	 *  async) or `confirmed` (canonical). Absent on older deployments. */
	state?: "optimistic" | "confirmed";
	txid: string;
	payer: string;
	network: string;
};

/** Bitcoin-native first — sBTC is the compelling micropay asset; USDCx the
 *  dollar peg; STX the fallback. Override via `preferAssets`. */
export const DEFAULT_PREFER_ASSETS: X402TokenSymbol[] = [
	"sBTC",
	"USDCx",
	"STX",
];

/** Default node for auto-resolving the payer's account nonce (`/v2/accounts`). */
export const DEFAULT_NONCE_NODE_URL = "https://api.hiro.so";

/** Thrown when no offered asset is within the caller's spend guard / preferences. */
export class X402SpendGuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "X402SpendGuardError";
	}
}

function b64encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function b64decodeJson<T>(value: string): T | null {
	try {
		return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
	} catch {
		return null;
	}
}

/** Read the x402 challenge from a 402 response — prefer the wire header, fall
 *  back to the JSON body. */
export async function readX402Challenge(
	res: Response,
): Promise<X402Challenge | null> {
	const header = res.headers.get("PAYMENT-REQUIRED");
	if (header) {
		const decoded = b64decodeJson<X402Challenge>(header);
		if (decoded) return decoded;
	}
	try {
		return (await res.clone().json()) as X402Challenge;
	} catch {
		return null;
	}
}

/** Read the settlement receipt from a paid 200 response. */
export function readX402Receipt(res: Response): X402Receipt | null {
	const header = res.headers.get("PAYMENT-RESPONSE");
	return header ? b64decodeJson<X402Receipt>(header) : null;
}

export type SelectOfferOptions = {
	preferAssets?: X402TokenSymbol[];
	maxAmountPerCall?: Partial<Record<X402TokenSymbol, bigint>>;
};

/** Choose an `accepts[]` entry by preference order, skipping any that exceed the
 *  per-asset spend cap. Throws {@link X402SpendGuardError} if none qualify. */
export function selectOffer(
	challenge: X402Challenge,
	opts: SelectOfferOptions = {},
): { accept: X402Accept; symbol: X402TokenSymbol } {
	const prefer = opts.preferAssets ?? DEFAULT_PREFER_ASSETS;
	for (const symbol of prefer) {
		const token = X402_TOKENS[symbol];
		const accept = challenge.accepts.find((a) => a.asset === token.asset);
		if (!accept) continue;
		const cap = opts.maxAmountPerCall?.[symbol];
		if (cap !== undefined && BigInt(accept.amount) > cap) continue;
		return { accept, symbol };
	}
	throw new X402SpendGuardError(
		"no x402 offer matched preferAssets within maxAmountPerCall",
	);
}

/** Fetch the payer account's next nonce from a Stacks node (`/v2/accounts`). */
export async function resolveAccountNonce(
	address: string,
	nodeUrl: string = DEFAULT_NONCE_NODE_URL,
): Promise<number> {
	const res = await fetch(
		`${nodeUrl.replace(/\/$/, "")}/v2/accounts/${address}?proof=0`,
	);
	if (!res.ok) throw new Error(`x402 nonce lookup failed: ${res.status}`);
	const json = (await res.json()) as { nonce: number };
	return json.nonce;
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

/** Build a signed, base64 `PAYMENT-SIGNATURE` header for one `accepts[]` entry. */
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

export type WithX402Options = SelectOfferOptions & {
	account: LocalAccount;
	/** Prepaid-credit token (PAYMENT-BALANCE) from a prior deposit — calls
	 *  debit the tab server-side instead of settling on-chain per call. */
	balanceToken?: string;
	/** Autonomous treasury policy: when the tab's remaining balance (read from
	 *  X-BALANCE-REMAINING-USD) drops below `whenBelow`, deposit `usd` more in
	 *  the background (one on-chain payment) and adopt the fresh token. */
	topUp?: { usd: number; whenBelow: number };
	/** Override the payer nonce; auto-resolved from `nodeUrl` when omitted. */
	accountNonce?: bigint | number | string;
	/** Node for auto-nonce lookup. Defaults to {@link DEFAULT_NONCE_NODE_URL}. */
	nodeUrl?: string;
	chain?: StacksChain;
	/** Fired just before the paid retry (the call then blocks on confirmed-tier
	 *  settle, or returns near-instantly on an optimistic surface). */
	onSettling?: (info: { asset: string; amount: string }) => void;
	/** Abort the paid retry after this long. */
	timeoutMs?: number;
};

export type X402Fetch = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

/**
 * Wrap a `fetch` so requests transparently pay on 402: select an offer (by
 * `preferAssets` + `maxAmountPerCall`), resolve the nonce, sign origin-only, and
 * retry once with `PAYMENT-SIGNATURE`. Returns the final `Response` (read the
 * receipt with {@link readX402Receipt}).
 *
 * @example
 * const x402fetch = withX402(fetch, { account });
 * const res = await x402fetch("https://api.secondlayer.tools/v1/index/events?event_type=ft_transfer");
 */
export function withX402(
	baseFetch: typeof fetch,
	opts: WithX402Options,
): X402Fetch {
	// Session vouchers (PAYMENT-SESSION): surfaces with session pricing hand
	// back a voucher on settle — replaying it lets subsequent calls ride the
	// paid session instead of re-paying per request. Cached per origin; the
	// server is authoritative (a 402 despite a voucher just restarts the
	// payment cycle and refreshes the cache).
	const sessions = new Map<string, string>();
	let balanceToken = opts.balanceToken ?? null;
	let toppingUp = false;
	const originOf = (input: Parameters<X402Fetch>[0]) => {
		try {
			return new URL(String(input)).origin;
		} catch {
			return "";
		}
	};

	const wrapped: X402Fetch = async (input, init) => {
		const origin = originOf(input);
		const run = (extra: Record<string, string>, signal?: AbortSignal) =>
			baseFetch(input, {
				...init,
				headers: { ...(init?.headers as Record<string, string>), ...extra },
				...(signal ? { signal } : {}),
			});

		// Treasury policy: refill the tab in the background before it empties.
		// The deposit goes through this same wrapper (402 → pay → credited);
		// its response carries the fresh PAYMENT-BALANCE token.
		const maybeTopUp = (res: Response) => {
			const policy = opts.topUp;
			if (!policy || toppingUp || !origin) return;
			const remaining = res.headers.get("X-BALANCE-REMAINING-USD");
			if (remaining === null || Number(remaining) >= policy.whenBelow) return;
			toppingUp = true;
			void (async () => {
				try {
					const dep = await wrapped(
						`${origin}/v1/x402/deposit?usd=${policy.usd}`,
						{ method: "POST" },
					);
					if (dep.ok) {
						const body = (await dep.json()) as { balance_token?: string };
						if (body.balance_token) balanceToken = body.balance_token;
					}
				} catch {
					// next sub-threshold response retries the top-up
				} finally {
					toppingUp = false;
				}
			})();
		};

		const remember = (res: Response) => {
			const voucher = res.headers.get("PAYMENT-SESSION");
			if (voucher && origin) sessions.set(origin, voucher);
			maybeTopUp(res);
			return res;
		};

		const cached = origin ? sessions.get(origin) : undefined;
		const first = await run({
			...(cached ? { "PAYMENT-SESSION": cached } : {}),
			...(balanceToken ? { "PAYMENT-BALANCE": balanceToken } : {}),
		});
		if (first.status !== 402) return remember(first);
		if (cached && origin) sessions.delete(origin);

		const challenge = await readX402Challenge(first);
		if (!challenge) return first;

		const { accept } = selectOffer(challenge, opts);
		const accountNonce =
			opts.accountNonce ??
			(await resolveAccountNonce(opts.account.address, opts.nodeUrl));
		const { header } = await buildSignedX402Payment({
			challenge,
			account: opts.account,
			accountNonce,
			asset: accept.asset,
			chain: opts.chain,
		});

		opts.onSettling?.({ asset: accept.asset, amount: accept.amount });
		const signal = opts.timeoutMs
			? AbortSignal.timeout(opts.timeoutMs)
			: undefined;
		return remember(await run({ "PAYMENT-SIGNATURE": header }, signal));
	};
	return wrapped;
}

export type X402ClientOptions = WithX402Options & {
	baseUrl: string;
	/** Override the underlying fetch (tests). */
	fetch?: typeof fetch;
};

export type X402Result<T = unknown> = {
	data: T;
	/** Settlement receipt, or null if the response carried none. */
	payment: X402Receipt | null;
	response: Response;
};

export type X402Client = {
	get<T = unknown>(
		path: string,
		o?: { query?: Record<string, string> },
	): Promise<X402Result<T>>;
	post<T = unknown>(
		path: string,
		o?: { body?: unknown },
	): Promise<X402Result<T>>;
};

/**
 * A small client over {@link withX402}: `.get/.post` against `baseUrl`, returning
 * parsed JSON plus the settlement receipt.
 *
 * @example
 * const sl = createX402Client({ account, baseUrl: "https://api.secondlayer.tools" });
 * const { data, payment } = await sl.get("/v1/index/events", { query: { event_type: "ft_transfer" } });
 */
export function createX402Client(opts: X402ClientOptions): X402Client {
	const f = withX402(opts.fetch ?? fetch, opts);
	const base = opts.baseUrl.replace(/\/$/, "");

	async function request<T>(
		method: "GET" | "POST",
		path: string,
		o: { query?: Record<string, string>; body?: unknown } = {},
	): Promise<X402Result<T>> {
		const qs = o.query ? `?${new URLSearchParams(o.query).toString()}` : "";
		const init: RequestInit = { method };
		if (o.body !== undefined) {
			init.body = JSON.stringify(o.body);
			init.headers = { "content-type": "application/json" };
		}
		const response = await f(`${base}${path}${qs}`, init);
		const data = (await response.json().catch(() => null)) as T;
		return { data, payment: readX402Receipt(response), response };
	}

	return {
		get: <T = unknown>(path: string, o?: { query?: Record<string, string> }) =>
			request<T>("GET", path, o),
		post: <T = unknown>(path: string, o?: { body?: unknown }) =>
			request<T>("POST", path, o),
	};
}

/** Caller-supplied fetch that re-runs the request with the given extra headers. */
export type X402FetchFn = (
	extraHeaders: Record<string, string>,
) => Promise<Response>;

export type PayAndRetryOptions = Omit<WithX402Options, never> & {
	/** Required here (use `withX402` for auto-nonce). */
	accountNonce: bigint | number | string;
};

/**
 * Low-level: run a request via a caller-controlled fetch; if it 402s, pay and
 * retry once. Prefer {@link withX402} for the common case (it auto-resolves the
 * nonce + selects the asset). Kept for custom transports.
 */
export async function payAndRetry(
	doFetch: X402FetchFn,
	opts: PayAndRetryOptions,
): Promise<Response> {
	const first = await doFetch({});
	if (first.status !== 402) return first;
	const challenge = await readX402Challenge(first);
	if (!challenge) return first;
	const { accept } = selectOffer(challenge, opts);
	const { header } = await buildSignedX402Payment({
		challenge,
		account: opts.account,
		accountNonce: opts.accountNonce,
		asset: accept.asset,
		chain: opts.chain,
	});
	return doFetch({ "PAYMENT-SIGNATURE": header });
}
