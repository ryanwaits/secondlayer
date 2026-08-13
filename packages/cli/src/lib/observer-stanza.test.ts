import { describe, expect, test } from "bun:test";
import {
	UnsupportedObserverError,
	parseObserverMode,
	renderObserverStanza,
	validateObserverStanza,
} from "./observer-stanza.ts";

describe("observer stanza", () => {
	test("refuses unknown modes", () => {
		expect(() => parseObserverMode("miner")).toThrow(UnsupportedObserverError);
	});

	test("indexer retries; signer-shared does not", () => {
		const indexer = renderObserverStanza({
			mode: "indexer",
			endpoint: "indexer:3700",
			network: "mainnet",
		});
		expect(indexer).toContain("disable_retries = false");
		expect(indexer).toContain("timeout_ms = 2000");

		const signer = renderObserverStanza({
			mode: "signer-shared",
			endpoint: "indexer:3700",
			network: "mainnet",
			recovery: "journal",
		});
		expect(signer).toContain("disable_retries = true");
		expect(signer).toContain("timeout_ms = 500");
	});

	test("refuses loopback on mainnet and URLs", () => {
		expect(() =>
			validateObserverStanza({
				mode: "indexer",
				endpoint: "127.0.0.1:3700",
				network: "mainnet",
			}),
		).toThrow(/container-visible/);
		expect(() =>
			validateObserverStanza({
				mode: "indexer",
				endpoint: "http://indexer:3700",
				network: "mainnet",
			}),
		).toThrow(/host:port/);
	});

	test("signer-shared requires a recovery source", () => {
		expect(() =>
			validateObserverStanza({
				mode: "signer-shared",
				endpoint: "indexer:3700",
				network: "mainnet",
			}),
		).toThrow(/recovery/);
	});

	test("devnet may use loopback", () => {
		const stanza = renderObserverStanza({
			mode: "indexer",
			endpoint: "127.0.0.1:3700",
			network: "devnet",
		});
		expect(stanza).toContain('endpoint = "127.0.0.1:3700"');
	});
});
