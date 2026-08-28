import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { loadConfig } from "../src/lib/config.ts";

const original = process.env.STACKS_NETWORK;
afterEach(() => {
	if (original === undefined) process.env.STACKS_NETWORK = undefined;
	else process.env.STACKS_NETWORK = original;
});

describe("loadConfig STACKS_NETWORK vocabulary", () => {
	test("devnet is the CLI spelling of the config file's local network", async () => {
		process.env.STACKS_NETWORK = "devnet";
		const config = await loadConfig();
		expect(config.network).toBe("local");
	});

	test("an unknown STACKS_NETWORK is named once on stderr instead of dropped silently", async () => {
		process.env.STACKS_NETWORK = "regtest";
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			await loadConfig();
			const lines = err.mock.calls.map((c) => String(c[0]));
			expect(lines.some((l) => l.includes("STACKS_NETWORK=regtest"))).toBe(
				true,
			);
		} finally {
			err.mockRestore();
		}
	});
});
