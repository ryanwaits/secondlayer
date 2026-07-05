import { expect, test } from "bun:test";
import { LOCK_WINDOW_MS, MAX_SUBSCRIPTION_TIMEOUT_MS } from "./emitter.ts";

test("webhook lock window exceeds the maximum subscription delivery timeout", () => {
	// A slow-but-alive receiver (timeout up to the schema max) must finish before
	// its outbox row becomes re-claimable, or it gets duplicate deliveries.
	expect(LOCK_WINDOW_MS).toBeGreaterThan(MAX_SUBSCRIPTION_TIMEOUT_MS);
	expect(MAX_SUBSCRIPTION_TIMEOUT_MS).toBe(300_000); // matches subscriptions schema max
});
