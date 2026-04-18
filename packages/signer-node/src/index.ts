/**
 * Reference signer service for Secondlayer workflows. Customer-hosted: your
 * private key never leaves your infrastructure.
 *
 * Deploy this service behind any HTTPS endpoint (Railway, Fly, Hetzner,
 * home server). Declare the endpoint in your workflow via
 * `signer.remote({ endpoint, publicKey, hmacRef })`.
 *
 * @example
 *   import { createSignerService } from "@secondlayer/signer-node"
 *   import {
 *     composePolicies,
 *     allowlistFunctions,
 *     dailyCapMicroStx,
 *   } from "@secondlayer/signer-node/policy"
 *
 *   const app = createSignerService({
 *     privateKeyHex: process.env.STACKS_PRIVATE_KEY!,
 *     hmacSecret:    process.env.SECONDLAYER_HMAC!,
 *     policy: composePolicies(
 *       allowlistFunctions({
 *         "SP123.dex-swap-v2": ["swap-usdc-for-stx"],
 *       }),
 *       dailyCapMicroStx(1_000_000_000n),
 *     ),
 *   })
 *
 *   Bun.serve({ fetch: app.fetch, port: 8787 })
 */

import { createHmac, randomBytes } from "node:crypto";
import {
	TransactionSigner,
	deserializeTransaction,
	privateKeyToAddress,
	privateKeyToPublic,
	publicKeyToHex,
} from "@stacks/transactions";
import { Hono } from "hono";
import type { Policy } from "./policy.ts";
import { denyAll } from "./policy.ts";
import type { SignRequest, SignResponse } from "./types.ts";

export type { Policy, PolicyDecision } from "./policy.ts";
export {
	allowlistFunctions,
	composePolicies,
	dailyCapMicroStx,
	denyAll,
	requireApproval,
} from "./policy.ts";
export type { SignRequest, SignResponse, TxBreakdown } from "./types.ts";

export interface SignerServiceConfig {
	/** Hex-encoded Stacks private key. Use env vars; never hardcode. */
	privateKeyHex: string;
	/** Shared HMAC secret matching the workflow's `hmacRef` value. */
	hmacSecret: string;
	/**
	 * Policy that must approve before signing. Default: deny-all (you MUST
	 * pass an explicit policy for the service to sign anything).
	 */
	policy?: Policy;
	/** Accept requests with an `issuedAt` no more than this many seconds old. */
	maxRequestAgeSeconds?: number;
	/**
	 * Persistence hook called after every successful sign. Implement this to
	 * record an audit log in your own DB.
	 */
	onAudit?: (entry: {
		requestId: string;
		runId: string;
		workflow: string;
		stepId: string;
		txId: string;
		signedAt: string;
	}) => Promise<void> | void;
}

const DEFAULT_MAX_AGE_SECONDS = 120;

/**
 * Build a Hono app that exposes a single `POST /sign` route. Mount on any
 * runtime that speaks the Fetch API (Bun.serve, Deno.serve, Cloudflare
 * Workers, AWS Lambda with `hono/aws-lambda`, Node via `@hono/node-server`).
 */
export function createSignerService(config: SignerServiceConfig): Hono {
	const policy = config.policy ?? denyAll;
	const maxAge = config.maxRequestAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
	const app = new Hono();

	app.get("/health", (c) => {
		const publicKey = publicKeyToHex(privateKeyToPublic(config.privateKeyHex));
		const address = privateKeyToAddress(config.privateKeyHex);
		return c.json({ ok: true, publicKey, address });
	});

	app.post("/sign", async (c) => {
		const rawBody = await c.req.text();
		const hmacHeader = c.req.header("X-Sl-Hmac");
		if (!hmacHeader) {
			return c.json<SignResponse>(
				{ ok: false, refused: true, reason: "missing X-Sl-Hmac header" },
				400,
			);
		}
		if (!verifyHmac(rawBody, hmacHeader, config.hmacSecret)) {
			return c.json<SignResponse>(
				{ ok: false, refused: true, reason: "invalid HMAC signature" },
				401,
			);
		}

		let request: SignRequest;
		try {
			request = JSON.parse(rawBody) as SignRequest;
		} catch {
			return c.json<SignResponse>(
				{ ok: false, refused: true, reason: "body is not valid JSON" },
				400,
			);
		}

		const issuedAt = Date.parse(request.issuedAt);
		if (Number.isNaN(issuedAt)) {
			return c.json<SignResponse>(
				{ ok: false, refused: true, reason: "issuedAt is not ISO-8601" },
				400,
			);
		}
		const ageSeconds = (Date.now() - issuedAt) / 1000;
		if (ageSeconds > maxAge) {
			return c.json<SignResponse>(
				{
					ok: false,
					refused: true,
					reason: `request is ${Math.round(ageSeconds)}s old (max ${maxAge}s)`,
				},
				400,
			);
		}

		const decision = await policy(request);
		if (!decision.approve) {
			return c.json<SignResponse>(
				{ ok: false, refused: true, reason: decision.reason },
				403,
			);
		}

		let signedTxHex: string;
		let txId: string;
		try {
			const raw = request.tx.unsignedTxHex.startsWith("0x")
				? request.tx.unsignedTxHex.slice(2)
				: request.tx.unsignedTxHex;
			const txBytes = new Uint8Array(Buffer.from(raw, "hex"));
			const unsigned = deserializeTransaction(txBytes);
			const txSigner = new TransactionSigner(unsigned);
			txSigner.signOrigin(config.privateKeyHex);
			const signed = txSigner.getTxInComplete();
			signedTxHex = Buffer.from(signed.serialize()).toString("hex");
			txId = signed.txid();
		} catch (err) {
			return c.json<SignResponse>(
				{
					ok: false,
					refused: true,
					reason: `sign error: ${err instanceof Error ? err.message : String(err)}`,
				},
				500,
			);
		}

		await config.onAudit?.({
			requestId: request.requestId,
			runId: request.runId,
			workflow: request.workflow,
			stepId: request.stepId,
			txId,
			signedAt: new Date().toISOString(),
		});

		return c.json<SignResponse>({
			ok: true,
			signedTxHex,
			nonce: request.tx.nonce,
		});
	});

	return app;
}

/**
 * Verify an HMAC-SHA256 header against the raw request body. Constant-time
 * comparison via `crypto.timingSafeEqual`.
 */
function verifyHmac(rawBody: string, header: string, secret: string): boolean {
	const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
	const received = header.startsWith("sha256=") ? header.slice(7) : header;
	if (expected.length !== received.length) return false;
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(received, "utf8");
	// timingSafeEqual throws if lengths differ — lengths equal by check above.
	try {
		return timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	}
	return diff === 0;
}

/** Utility: generate a fresh HMAC secret for use with `sl secrets set`. */
export function generateHmacSecret(): string {
	return randomBytes(32).toString("hex");
}
