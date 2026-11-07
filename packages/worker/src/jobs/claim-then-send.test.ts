import { describe, expect, test } from "bun:test";
import { claimThenSend } from "./claim-then-send.ts";

describe("claimThenSend", () => {
	test("sends once when the claim is won", async () => {
		const calls: string[] = [];
		const sent = await claimThenSend({
			claim: async () => {
				calls.push("claim");
				return true;
			},
			send: async () => {
				calls.push("send");
			},
			release: async () => {
				calls.push("release");
			},
		});
		expect(sent).toBe(true);
		expect(calls).toEqual(["claim", "send"]);
	});

	test("never sends when the claim is lost", async () => {
		const calls: string[] = [];
		const sent = await claimThenSend({
			claim: async () => false,
			send: async () => {
				calls.push("send");
			},
			release: async () => {
				calls.push("release");
			},
		});
		expect(sent).toBe(false);
		expect(calls).toEqual([]);
	});

	test("releases the claim and rethrows when the send fails", async () => {
		const calls: string[] = [];
		await expect(
			claimThenSend({
				claim: async () => true,
				send: async () => {
					throw new Error("smtp down");
				},
				release: async () => {
					calls.push("release");
				},
			}),
		).rejects.toThrow("smtp down");
		expect(calls).toEqual(["release"]);
	});

	test("a failing release does not mask the send error", async () => {
		await expect(
			claimThenSend({
				claim: async () => true,
				send: async () => {
					throw new Error("smtp down");
				},
				release: async () => {
					throw new Error("db down");
				},
			}),
		).rejects.toThrow("smtp down");
	});
});
