import { describe, expect, test } from "bun:test";
import { defaultInternalIndexApiKey } from "@secondlayer/shared/index-internal-auth";
import { DEFAULT_INDEX_TOKENS, INDEX_READ_SCOPE } from "./auth.ts";

describe("index internal token", () => {
	test("internal key resolves to an unmetered enterprise tenant", async () => {
		const tenant = await DEFAULT_INDEX_TOKENS.get(defaultInternalIndexApiKey());
		expect(tenant).toBeDefined();
		expect(tenant?.tier).toBe("enterprise");
		// No account_id → Index metering (`accountId && …`) never fires for the
		// internal consumer, so PublicApiBlockSource reads are unmetered.
		expect(tenant?.account_id).toBeUndefined();
		expect(tenant?.scopes).toContain(INDEX_READ_SCOPE);
	});
});
