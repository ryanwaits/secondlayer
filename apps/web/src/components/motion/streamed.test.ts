import { describe, expect, test } from "bun:test";
import { shouldEndStreamed } from "./streamed";

describe("streamed fade", () => {
	test("ends when the visitor leaves the page that streamed", () => {
		expect(shouldEndStreamed("/account", "/account")).toBe(false);
		expect(shouldEndStreamed("/account", "/account/webhooks")).toBe(true);
	});
});
