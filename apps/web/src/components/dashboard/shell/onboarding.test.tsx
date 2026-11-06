import { describe, expect, test } from "bun:test";
import { hasNoKey, onboardingProgress } from "@/lib/onboarding";
import type { ApiKey } from "@/lib/types";

const NOW = new Date("2026-10-15T12:00:00.000Z");

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sk-sl_abc12345",
	name: "laptop",
	status: "active",
	product: "account",
	tier: null,
	createdAt: "2026-10-01T00:00:00.000Z",
	lastUsedAt: null,
	...patch,
});

describe("onboarding progress", () => {
	test("no key until the list has loaded and shows none of your own", () => {
		expect(hasNoKey(null, NOW)).toBe(false);
		expect(hasNoKey([], NOW)).toBe(true);
		expect(hasNoKey([key({ product: "tenant" })], NOW)).toBe(true);
		expect(hasNoKey([key({ status: "revoked" })], NOW)).toBe(true);
		expect(hasNoKey([key({})], NOW)).toBe(false);
	});

	test("a key and then a first read, or a webhook or subgraph, complete it", () => {
		expect(onboardingProgress([], NOW, false)).toMatchObject({ key: false });
		expect(onboardingProgress([key({})], NOW, false)).toMatchObject({
			key: true,
			read: false,
			complete: false,
		});
		const read = [key({ lastUsedAt: "2026-10-15T11:00:00.000Z" })];
		expect(onboardingProgress(read, NOW, false).complete).toBe(true);
		expect(onboardingProgress([key({})], NOW, true).complete).toBe(true);
	});
});
