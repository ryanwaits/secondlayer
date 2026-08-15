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

	test("a misspelled key in our namespace is rejected before ingest", () => {
		const result = parseRuntimeConfig({ ...good, SUBGRAPH_SORCE: "1" });
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.errors.some((e) => e.includes("SUBGRAPH_SORCE"))).toBe(
				true,
			);
	});

	test("ambient container environ does not fail the boot", () => {
		const result = parseRuntimeConfig({
			...good,
			PATH: "/usr/local/bin:/usr/bin",
			HOME: "/root",
			HOSTNAME: "8f2c1a9d41e0",
			PWD: "/app",
			SHLVL: "1",
			PORT: "3800",
			NODE: "/usr/local/bin/node",
			BUN_INSTALL_BIN: "/root/.bun/bin",
			BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
			TERM: "xterm",
			LANG: "C.UTF-8",
		});
		expect(result.ok).toBe(true);
	});

	test("keys the shipped compose sets are known", () => {
		const result = parseRuntimeConfig({
			...good,
			STREAMS_API_URL: "http://127.0.0.1:3800",
			STREAMS_INTERNAL_API_KEY: "",
			SUBGRAPH_SOURCE: "streams-index",
			SUBGRAPH_INDEX_API_URL: "http://127.0.0.1:3800",
			SBTC_DECODER_ENABLED: "true",
			POX4_DECODER_ENABLED: "true",
			BNS_DECODER_ENABLED: "false",
		});
		expect(result.ok).toBe(true);
	});

	test("archive publishing keys are known", () => {
		// Both live in the ARCHIVE_ namespace the refusal patrols, so an operator
		// publishing an archive from a one-box runtime would otherwise be told
		// their working config was a typo.
		const result = parseRuntimeConfig({
			...good,
			ARCHIVE_DIR: "/data/archive",
			ARCHIVE_PUBLIC_DIR: "/data/archive/canonical-v1-staging",
		});
		expect(result.ok).toBe(true);
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
