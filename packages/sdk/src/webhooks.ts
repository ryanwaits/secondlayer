import { verifySignatureHeader } from "@secondlayer/shared/crypto/hmac";

export { verifySignatureHeader };

/**
 * Verify a webhook delivery signature from Secondlayer.
 *
 * Every delivery includes an `x-secondlayer-signature` header in the format
 * `t=<timestamp>,v1=<hmac>`. This function verifies the HMAC and checks
 * the timestamp is within the tolerance window (default 5 minutes).
 *
 * @param rawBody - The raw request body as a string (not parsed JSON)
 * @param signatureHeader - The value of the `x-secondlayer-signature` header
 * @param secret - Your signing secret
 * @param toleranceSeconds - Max age of signature in seconds (default 300)
 * @returns true if the signature is valid
 *
 * @example
 * ```ts
 * import { verifyWebhookSignature } from "@secondlayer/sdk";
 *
 * app.post("/webhook", (req, res) => {
 *   const sig = req.headers["x-secondlayer-signature"];
 *   const raw = JSON.stringify(req.body);
 *   if (!verifyWebhookSignature(raw, sig, process.env.SIGNING_SECRET!)) {
 *     return res.status(401).send("Invalid signature");
 *   }
 *   // Process the event...
 * });
 * ```
 */
export function verifyWebhookSignature(
	rawBody: string,
	signatureHeader: string,
	secret: string,
	toleranceSeconds = 300,
): boolean {
	return verifySignatureHeader(
		rawBody,
		signatureHeader,
		secret,
		toleranceSeconds,
	);
}
