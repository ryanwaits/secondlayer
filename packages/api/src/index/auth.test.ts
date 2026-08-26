import { describe, expect, test } from "bun:test";
import {
	INDEX_INTERNAL_TENANT_ID,
	defaultInternalIndexApiKey,
} from "@secondlayer/shared/index-internal-auth";
import { DEFAULT_INDEX_TOKENS, INDEX_READ_SCOPE } from "./auth.ts";

describe("index internal token", () => {
	test("internal key resolves to an unmetered internal tenant when env is set", async () => {
		const seeded = process.env.INDEX_INTERNAL_API_KEY?.trim();
		if (seeded) {
			const tenant = await DEFAULT_INDEX_TOKENS.get(seeded);
			expect(tenant).toBeDefined();
			expect(tenant?.tenant_id).toBe(INDEX_INTERNAL_TENANT_ID);
			expect(tenant?.tier).toBe("internal");
			// No account_id → Index metering (`accountId && …`) never fires for the
			// internal consumer, so PublicApiBlockSource reads are unmetered.
			expect(tenant?.account_id).toBeUndefined();
			expect(tenant?.scopes).toContain(INDEX_READ_SCOPE);
			return;
		}
		// Module loaded without INDEX_INTERNAL_API_KEY: helper may return
		// INSTANCE_TOKEN, which is not in this static map (instanceTokenMatches
		// handles that path). Guard Map.get so we never pass undefined.
		const fallback = defaultInternalIndexApiKey();
		if (fallback) {
			expect(await DEFAULT_INDEX_TOKENS.get(fallback)).toBeUndefined();
		} else {
			expect(fallback).toBeUndefined();
		}
	});
});
