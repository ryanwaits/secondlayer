import { describe, expect, test } from "bun:test";
import { PermissionChangeInputSchema } from "../src/kinds/permission-change.ts";

describe("PermissionChangeInputSchema", () => {
	test("accepts a valid input", () => {
		const result = PermissionChangeInputSchema.safeParse({
			sentryId: "550e8400-e29b-41d4-a716-446655440000",
			principal: "SP1234567890ABCDEFGHIJKLMNOPQRSTUV.my-contract",
			adminFunctions: ["set-owner", "transfer-ownership"],
			deliveryWebhook: "https://hooks.example.com/x",
			sinceIso: null,
		});
		expect(result.success).toBe(true);
	});

	test("rejects empty adminFunctions", () => {
		const result = PermissionChangeInputSchema.safeParse({
			sentryId: "550e8400-e29b-41d4-a716-446655440000",
			principal: "SP1234567890ABCDEFGHIJKLMNOPQRSTUV.my-contract",
			adminFunctions: [],
			deliveryWebhook: "https://hooks.example.com/x",
			sinceIso: null,
		});
		expect(result.success).toBe(false);
	});

	test("rejects non-uuid sentryId", () => {
		const result = PermissionChangeInputSchema.safeParse({
			sentryId: "not-a-uuid",
			principal: "SP1234567890ABCDEFGHIJKLMNOPQRSTUV.my-contract",
			adminFunctions: ["set-owner"],
			deliveryWebhook: "https://hooks.example.com/x",
			sinceIso: null,
		});
		expect(result.success).toBe(false);
	});
});
