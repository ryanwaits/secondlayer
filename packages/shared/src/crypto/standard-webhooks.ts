import { createHmac, randomUUID } from "node:crypto";

/**
 * Standard Webhooks signing helpers — https://standardwebhooks.com
 *
 * Produces the three headers that every Standard Webhooks receiver expects:
 *   webhook-id         — UUID identifying the delivery (used for dedup)
 *   webhook-timestamp  — unix seconds, receiver rejects if skew > tolerance
 *   webhook-signature  — space-separated list of `vN,<base64-hmac>` tuples
 *
 * The signed content is `{id}.{timestamp}.{body}`. The HMAC key is the raw
 * bytes of the secret. If the secret is a `whsec_`-prefixed base64 string
 * (the Svix convention) we base64-decode after stripping the prefix;
 * otherwise we use the UTF-8 bytes directly.
 */

export interface StandardWebhooksHeaders {
	"webhook-id": string;
	"webhook-timestamp": string;
	"webhook-signature": string;
}

export interface SignOptions {
	/** Override the delivery id. Defaults to a random UUID v4. */
	id?: string;
	/** Override the timestamp (unix seconds). Defaults to `Date.now()`. */
	timestampSeconds?: number;
}

function secretToKey(secret: string): Buffer {
	if (secret.startsWith("whsec_")) {
		return Buffer.from(secret.slice("whsec_".length), "base64");
	}
	return Buffer.from(secret, "utf8");
}

export function sign(
	body: string,
	secret: string,
	opts: SignOptions = {},
): StandardWebhooksHeaders {
	const id = opts.id ?? randomUUID();
	const timestamp = String(
		opts.timestampSeconds ?? Math.floor(Date.now() / 1000),
	);
	const toSign = `${id}.${timestamp}.${body}`;
	const key = secretToKey(secret);
	const signature = createHmac("sha256", key).update(toSign).digest("base64");
	return {
		"webhook-id": id,
		"webhook-timestamp": timestamp,
		"webhook-signature": `v1,${signature}`,
	};
}

export interface VerifyOptions {
	/** Max clock skew in seconds. Default 5 minutes per spec. */
	toleranceSeconds?: number;
	/** Current time in unix seconds. Injectable for testing. */
	nowSeconds?: number;
}

export function verify(
	body: string,
	headers:
		| StandardWebhooksHeaders
		| Record<string, string | string[] | undefined>,
	secret: string,
	opts: VerifyOptions = {},
): boolean {
	const pick = (k: string) => {
		const v = (headers as Record<string, unknown>)[k];
		return typeof v === "string" ? v : undefined;
	};
	const id = pick("webhook-id");
	const timestamp = pick("webhook-timestamp");
	const sigHeader = pick("webhook-signature");
	if (!id || !timestamp || !sigHeader) return false;

	const ts = Number.parseInt(timestamp, 10);
	if (!Number.isFinite(ts)) return false;
	const tolerance = opts.toleranceSeconds ?? 5 * 60;
	const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
	if (Math.abs(now - ts) > tolerance) return false;

	const key = secretToKey(secret);
	const expected = createHmac("sha256", key)
		.update(`${id}.${timestamp}.${body}`)
		.digest("base64");

	// webhook-signature can carry multiple versions: "v1,abc v1a,def"
	for (const part of sigHeader.split(" ")) {
		const [version, sig] = part.split(",", 2);
		if (version !== "v1" || !sig) continue;
		if (sig.length !== expected.length) continue;
		let diff = 0;
		for (let i = 0; i < sig.length; i++) {
			diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
		}
		if (diff === 0) return true;
	}
	return false;
}
