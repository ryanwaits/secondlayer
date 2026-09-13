import { expect, test } from "bun:test";
import { LOCK_WINDOW_MS, MAX_WEBHOOK_TIMEOUT_MS } from "./emitter.ts";

test("webhook lock window exceeds the maximum webhook delivery timeout", () => {
	// A slow-but-alive receiver (timeout up to the schema max) must finish before
	// its outbox row becomes re-claimable, or it gets duplicate deliveries.
	expect(LOCK_WINDOW_MS).toBeGreaterThan(MAX_WEBHOOK_TIMEOUT_MS);
	expect(MAX_WEBHOOK_TIMEOUT_MS).toBe(300_000); // matches webhooks schema max
});
