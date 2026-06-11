import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * x402 session vouchers — one payment buys a bounded session instead of a
 * single call. The settle step mints a signed voucher (id = the payment's
 * challenge nonce, so each payment yields exactly one session); subsequent
 * requests present it via `PAYMENT-SESSION` and pass free until the session's
 * call budget or TTL runs out, then the 402 cycle starts again.
 *
 * Stateless verification (HMAC over the payload) + one rate-limit-store
 * counter per session id for the call budget. No DB writes.
 */

export type X402SessionVoucher = {
	v: 1;
	/** Session id — the settled payment's challenge nonce (unique per payment). */
	id: string;
	surface: string;
	payer: string;
	/** Unix ms expiry. */
	exp: number;
};

function hmac(payload: string, secret: string): Buffer {
	return createHmac("sha256", secret).update(payload).digest();
}

const b64 = (s: string | Buffer) =>
	Buffer.from(s as never).toString("base64url");

export function mintSessionVoucher(
	voucher: X402SessionVoucher,
	secret: string,
): string {
	const payload = b64(JSON.stringify(voucher));
	return `${payload}.${b64(hmac(payload, secret))}`;
}

export function verifySessionVoucher(
	token: string,
	secret: string,
	now: number = Date.now(),
): X402SessionVoucher | null {
	const dot = token.lastIndexOf(".");
	if (dot <= 0) return null;
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expected = hmac(payload, secret);
	let given: Buffer;
	try {
		given = Buffer.from(sig, "base64url");
	} catch {
		return null;
	}
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		return null;
	}
	let voucher: X402SessionVoucher;
	try {
		voucher = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (voucher.v !== 1 || typeof voucher.exp !== "number") return null;
	if (voucher.exp <= now) return null;
	return voucher;
}

/** Server-side session signing secret. */
export function getSessionSecret(): string | undefined {
	return process.env.SECONDLAYER_SECRETS_KEY;
}
