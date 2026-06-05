import { verifySecondlayerSignatureValues } from "@secondlayer/shared/crypto/secondlayer-webhook";
import {
	type StandardWebhooksHeaders,
	verify,
} from "@secondlayer/shared/crypto/standard-webhooks";

export {
	type StandardWebhooksHeaders,
	verify as verifyStandardWebhooksHeaders,
} from "@secondlayer/shared/crypto/standard-webhooks";

type HeaderLookup = (name: string) => string | null | undefined;
export type WebhookHeaderInput =
	| HeaderLookup
	| StandardWebhooksHeaders
	| Record<string, string | string[] | undefined>
	| { get: (name: string) => string | null }; // e.g. Fetch `Headers`

function pickHeader(
	headers: WebhookHeaderInput,
	name: string,
): string | undefined {
	if (typeof headers === "function") {
		const v = (headers as HeaderLookup)(name);
		return typeof v === "string" ? v : undefined;
	}
	if (
		typeof (headers as { get?: unknown }).get === "function" &&
		!(name in (headers as Record<string, unknown>))
	) {
		const v = (headers as { get: (n: string) => string | null }).get(name);
		return typeof v === "string" ? v : undefined;
	}
	const bag = headers as Record<string, string | string[] | undefined>;
	let v = bag[name] ?? bag[name.toLowerCase()];
	if (v === undefined) {
		const target = name.toLowerCase();
		for (const key of Object.keys(bag)) {
			if (key.toLowerCase() === target) {
				v = bag[key];
				break;
			}
		}
	}
	if (Array.isArray(v)) return v[0];
	return typeof v === "string" ? v : undefined;
}

/**
 * Verify a Secondlayer webhook delivery signature.
 *
 * Every delivery whose subscription `format` is `"standard-webhooks"` (the
 * default) carries three Standard Webhooks headers:
 *
 *   webhook-id         — UUID for the delivery (stable across retries; use as
 *                        your dedup key)
 *   webhook-timestamp  — unix seconds at dispatch time
 *   webhook-signature  — space-separated list of `v1,<base64-hmac>` tuples
 *
 * The signed content is `${id}.${timestamp}.${rawBody}` HMAC-SHA256 with the
 * signing secret. Secrets returned by `sl subscriptions create` (or
 * `rotate-secret`) carry a `whsec_` prefix and are base64-decoded after the
 * prefix is stripped, matching the Svix / Standard Webhooks convention.
 *
 * @param rawBody         The raw request body as a string. NEVER pass
 *                        `JSON.stringify(req.body)` — re-stringifying drops
 *                        key ordering and whitespace, breaking the HMAC.
 *                        Use the raw body bytes/string your framework hands
 *                        you (Express raw body middleware, Hono `c.req.text()`,
 *                        Bun `await req.text()`, etc.).
 * @param headers         The request headers. Accepts a plain object
 *                        (Express / Node), a Fetch `Headers` instance
 *                        (Bun / Hono / Workers), or a callback that returns
 *                        a header value by name. Header name matching is
 *                        case-insensitive.
 * @param secret          The signing secret returned by
 *                        `sl subscriptions create` / `rotateSecret`. Pass it
 *                        through verbatim — the helper handles the `whsec_`
 *                        prefix.
 * @param toleranceSeconds Max age of `webhook-timestamp` in seconds. Default
 *                         300 (5 min) per the Standard Webhooks spec.
 * @returns true if every header is present, the timestamp is within
 *          tolerance, and a `v1` signature matches.
 *
 * @example
 * ```ts
 * // Hono / Bun
 * import { verifyWebhookSignature } from "@secondlayer/sdk";
 *
 * app.post("/webhook", async (c) => {
 *   const raw = await c.req.text();
 *   if (!verifyWebhookSignature(raw, c.req.raw.headers, process.env.SIGNING_SECRET!)) {
 *     return c.text("Invalid signature", 401);
 *   }
 *   const { type, timestamp, data } = JSON.parse(raw);
 *   // ... process data ...
 *   return c.body(null, 204);
 * });
 * ```
 *
 * @example
 * ```ts
 * // Express with raw-body middleware
 * import express from "express";
 * import { verifyWebhookSignature } from "@secondlayer/sdk";
 *
 * app.post(
 *   "/webhook",
 *   express.raw({ type: "application/json" }),
 *   (req, res) => {
 *     const raw = req.body.toString("utf8");
 *     if (!verifyWebhookSignature(raw, req.headers, process.env.SIGNING_SECRET!)) {
 *       return res.status(401).end();
 *     }
 *     // ... process raw ...
 *     res.status(204).end();
 *   },
 * );
 * ```
 */
export function verifyWebhookSignature(
	rawBody: string,
	headers: WebhookHeaderInput,
	secret: string,
	toleranceSeconds = 300,
): boolean {
	const id = pickHeader(headers, "webhook-id");
	const timestamp = pickHeader(headers, "webhook-timestamp");
	const signature = pickHeader(headers, "webhook-signature");
	if (!id || !timestamp || !signature) return false;
	return verify(
		rawBody,
		{
			"webhook-id": id,
			"webhook-timestamp": timestamp,
			"webhook-signature": signature,
		},
		secret,
		{ toleranceSeconds },
	);
}

/**
 * Verify the universal Secondlayer authenticity signature that every delivery
 * carries, regardless of body format (`raw`, `cloudevents`, `standard-webhooks`,
 * …). This is the format-agnostic alternative to {@link verifyWebhookSignature}:
 * instead of a per-subscription HMAC secret, it checks an ed25519 signature over
 * `${webhook-id}.${rawBody}` against Secondlayer's published public key — so one
 * key proves authenticity for any format.
 *
 * @param rawBody    The raw request body string (never re-stringify the parsed
 *                   JSON — whitespace/key-order changes break the signature).
 * @param headers    Request headers — plain object, Fetch `Headers`, or a
 *                   lookup callback. Reads `webhook-id` + `x-secondlayer-signature`.
 * @param publicKeyPem Secondlayer's published ed25519 public key (SPKI PEM).
 * @returns true when the signature header is present and verifies.
 *
 * @example
 * ```ts
 * import { verifySecondlayerSignature } from "@secondlayer/sdk";
 *
 * app.post("/webhook", async (c) => {
 *   const raw = await c.req.text();
 *   if (!verifySecondlayerSignature(raw, c.req.raw.headers, SECONDLAYER_PUBLIC_KEY)) {
 *     return c.text("Invalid signature", 401);
 *   }
 *   // ... process raw ...
 *   return c.body(null, 204);
 * });
 * ```
 */
export function verifySecondlayerSignature(
	rawBody: string,
	headers: WebhookHeaderInput,
	publicKeyPem: string,
): boolean {
	const id = pickHeader(headers, "webhook-id");
	const signature = pickHeader(headers, "x-secondlayer-signature");
	return verifySecondlayerSignatureValues(rawBody, id, signature, publicKeyPem);
}
