---
"@secondlayer/sdk": major
---

fix(sdk): verifyWebhookSignature now validates the real Standard Webhooks delivery format

The previous implementation validated a Stripe-style `x-secondlayer-signature` header that no Secondlayer delivery format actually emits — so it returned `false` for every real webhook. The signature has changed:

```ts
// before — validated nothing in production
verifyWebhookSignature(rawBody, signatureHeader: string, secret, toleranceSeconds?)

// after — validates `standard-webhooks` (the default format)
verifyWebhookSignature(rawBody, headers, secret, toleranceSeconds?)
```

`headers` accepts a plain object (Express `req.headers`), a Fetch `Headers` instance (Hono / Bun / Workers), or a callback `(name) => value`. Header lookup is case-insensitive.

Also exports `StandardWebhooksHeaders` and `verifyStandardWebhooksHeaders` (the lower-level helper from `@secondlayer/shared/crypto/standard-webhooks`) for advanced cases.
