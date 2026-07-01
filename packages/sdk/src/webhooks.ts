import type { ChainWebhookDelivery } from "@secondlayer/shared";
import { verifySecondlayerSignatureValues } from "@secondlayer/shared/crypto/secondlayer-webhook";
import {
	type StandardWebhooksHeaders,
	verify,
} from "@secondlayer/shared/crypto/standard-webhooks";

export {
	type StandardWebhooksHeaders,
	verify as verifyStandardWebhooksHeaders,
} from "@secondlayer/shared/crypto/standard-webhooks";
export type {
	ChainApplyEnvelope,
	ChainApplyEnvelopeOf,
	ChainEventEnvelope,
	ChainFtBurnData,
	ChainFtMintData,
	ChainFtTransferData,
	ChainNftBurnData,
	ChainNftMintData,
	ChainNftTransferData,
	ChainPrintEventData,
	ChainReorgOrphanedEntry,
	ChainReorgRollbackDelivery,
	ChainReorgRollbackEnvelope,
	ChainStxBurnData,
	ChainStxLockData,
	ChainStxMintData,
	ChainStxTransferData,
	ChainTestDelivery,
	ChainTxLevelEvent,
	ChainWebhookDelivery,
	ChainWebhookEnvelope,
} from "@secondlayer/shared";

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
 * `rotate-secret`) are a bare 64-character hex string used directly as the
 * HMAC key (its UTF-8 bytes) — this helper handles that. A `whsec_`-prefixed
 * base64 secret (the Svix convention) is also accepted and base64-decoded after
 * the prefix is stripped. Note: because the issued secret is bare hex (no
 * `whsec_` prefix), a generic Svix / Standard Webhooks library will base64-
 * decode it and derive the wrong key — verify with this helper (or with
 * {@link verifySecondlayerSignature}, the format-agnostic ed25519 path).
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
 *                        `sl subscriptions create` / `rotateSecret` (a bare
 *                        64-char hex string). Pass it through verbatim — the
 *                        helper accepts both bare hex and `whsec_`-prefixed
 *                        base64 secrets.
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

/**
 * Decode + narrow a chain-subscription webhook delivery body into a typed
 * {@link ChainWebhookDelivery}. Verify the signature first with
 * {@link verifyWebhookSignature} (or {@link verifySecondlayerSignature}), then
 * decode the same raw body — this does not check authenticity, only shape.
 *
 * Only understands the `format: "standard-webhooks"` envelope (`{ type,
 * timestamp, data }`) — the subscription default, and the only format
 * `verifyWebhookSignature` covers. Other formats (`raw`, `cloudevents`, …)
 * carry the same `data` value under a different envelope; see the "Chain
 * subscription webhook payloads" doc for how to unwrap those.
 *
 * A chain-subscription delivery is NOT a Streams/Index event — do not run this
 * over a `StreamsEvent` body (`{ event_type, payload }`) or vice versa.
 *
 * @param rawBody The raw request body string (same bytes passed to
 *                {@link verifyWebhookSignature}).
 * @throws {Error} if the body isn't a `chain.*` delivery, or the envelope is
 *         internally inconsistent (e.g. `type` and `data.trigger` disagree —
 *         a sign the wire shape drifted from this decoder).
 *
 * @example
 * ```ts
 * import { decodeChainWebhook, verifyWebhookSignature } from "@secondlayer/sdk";
 *
 * app.post("/webhook", async (c) => {
 *   const raw = await c.req.text();
 *   if (!verifyWebhookSignature(raw, c.req.raw.headers, process.env.SIGNING_SECRET!)) {
 *     return c.text("Invalid signature", 401);
 *   }
 *   const delivery = decodeChainWebhook(raw);
 *   if (delivery.data.action === "apply" && delivery.data.trigger === "stx_transfer") {
 *     delivery.data.event.data.amount; // typed
 *   }
 *   return c.body(null, 204);
 * });
 * ```
 */
export function decodeChainWebhook(rawBody: string): ChainWebhookDelivery {
	const parsed = JSON.parse(rawBody) as {
		type?: unknown;
		timestamp?: unknown;
		data?: unknown;
	};
	if (
		typeof parsed.type !== "string" ||
		typeof parsed.timestamp !== "string" ||
		typeof parsed.data !== "object" ||
		parsed.data === null
	) {
		throw new Error(
			"decodeChainWebhook: not a chain-subscription delivery — expected { type, timestamp, data }",
		);
	}
	if (!parsed.type.startsWith("chain.")) {
		throw new Error(
			`decodeChainWebhook: not a chain-subscription delivery (type "${parsed.type}")`,
		);
	}

	const data = parsed.data as Record<string, unknown>;
	if (parsed.type === "chain.test.apply") {
		if (data.test !== true) {
			throw new Error(
				'decodeChainWebhook: "chain.test.apply" body missing `data.test: true`',
			);
		}
	} else if (parsed.type === "chain.reorg.rollback") {
		if (data.action !== "rollback" || !Array.isArray(data.orphaned)) {
			throw new Error(
				'decodeChainWebhook: "chain.reorg.rollback" body missing `data.action`/`data.orphaned`',
			);
		}
	} else {
		if (data.action !== "apply" || typeof data.trigger !== "string") {
			throw new Error(
				"decodeChainWebhook: apply delivery missing `data.action`/`data.trigger`",
			);
		}
		if (parsed.type !== `chain.${data.trigger}.apply`) {
			throw new Error(
				`decodeChainWebhook: type "${parsed.type}" doesn't match data.trigger "${data.trigger}"`,
			);
		}
	}

	return parsed as unknown as ChainWebhookDelivery;
}
