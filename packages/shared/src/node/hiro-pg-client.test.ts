import { describe, expect, test } from "bun:test";
import { mapTxStatus } from "./hiro-pg-client.ts";

// Hiro stacks-blockchain-api DbTxStatus codes (src/datastore/common.ts).
describe("mapTxStatus", () => {
	test("maps Hiro success code 1 to success", () => {
		expect(mapTxStatus(1)).toBe("success");
	});

	test("maps Hiro code -1 to abort_by_response", () => {
		expect(mapTxStatus(-1)).toBe("abort_by_response");
	});

	test("maps Hiro code -2 to abort_by_post_condition", () => {
		expect(mapTxStatus(-2)).toBe("abort_by_post_condition");
	});

	test("rejects codes that are not a mined result instead of guessing", () => {
		expect(() => mapTxStatus(0)).toThrow();
		expect(() => mapTxStatus(-3)).toThrow();
		expect(() => mapTxStatus(-10)).toThrow();
	});
});
