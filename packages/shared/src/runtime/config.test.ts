import { describe, expect, test } from "bun:test";
import { REQUIRED_KEYS, parseRuntimeConfig } from "./config.ts";

const good = {
	NETWORK: "mainnet",
	DATABASE_URL: "postgres://secondlayer@postgres/secondlayer",
	NODE_MODE: "external",
	DATA_DIR: "/data",
	API_PORT: "3800",
	INDEXER_PORT: "3700",
};

describe("minimal config", () => {
	test("six required non-secret keys", () => {
		expect(REQUIRED_KEYS).toHaveLength(6);
	});

	test("a valid matrix parses", () => {
		const result = parseRuntimeConfig(good);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.config.NETWORK).toBe("mainnet");
	});

	test("unknown keys are rejected before ingest", () => {
		const result = parseRuntimeConfig({ ...good, L2_FOO: "1" });
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.errors.some((e) => e.includes("L2_FOO"))).toBe(true);
	});

	test("full mode without bitcoin password is contradictory", () => {
		const result = parseRuntimeConfig({ ...good, NODE_MODE: "full" });
		expect(result.ok).toBe(false);
	});

	test("external mode rejects a bitcoin password", () => {
		const result = parseRuntimeConfig({
			...good,
			BITCOIN_RPC_PASSWORD: "x",
		});
		expect(result.ok).toBe(false);
	});
});
