import { describe, expect, test } from "bun:test";
import {
	type SecondLayer,
	SecondLayer as SecondLayerClient,
	type StreamsEvent,
	trigger,
} from "@secondlayer/sdk";
import {
	CLI_SNIPPET,
	INDEX_SNIPPET,
	SBTC_ASSET_IDENTIFIER,
	SBTC_CONTRACT_ID,
	SHELL_GETSTARTED_SNIPPET,
	STREAMS_SNIPPET,
	SUBGRAPHS_SNIPPET,
	SUBSCRIPTIONS_SNIPPET,
} from "./home-snippets";

// Compile-checked twins of the homepage snippets. These are never executed
// (no network) — they exist so `tsc --noEmit` fails the moment the SDK surface
// drifts from what the homepage promises. Keep each twin in sync with its
// string constant in home-snippets.ts.

// STREAMS_SNIPPET
async function streamsTwin(
	sl: SecondLayer,
	cursor: string,
	handle: (events: StreamsEvent[]) => Promise<void>,
) {
	for await (const batch of sl.streams.consume({ cursor })) {
		await handle(batch.events); // ordered, reorg-aware
	}
	const dumps = await sl.streams.dumps.list();
	return dumps;
}

// INDEX_SNIPPET
async function indexTwin(
	sl: SecondLayer,
	save: (t: { sender: string; recipient: string; amount: string }) => Promise<void>,
) {
	for await (const t of sl.index.ftTransfers.walk({
		contractId: SBTC_CONTRACT_ID,
	})) {
		await save(t); // typed: sender, recipient, amount
	}
	return sl.index.events({ eventType: "ft_transfer", trait: "sip-010" });
}

// SUBGRAPHS_SNIPPET (the SDK read; the defineSubgraph() half is type-checked
// in @secondlayer/subgraphs itself, which this app doesn't depend on).
async function subgraphsTwin(sl: SecondLayer) {
	const { rows } = await sl.subgraphs.rows("sbtc-flows", "transfers", {
		limit: 3,
	});
	return rows;
}

// SUBSCRIPTIONS_SNIPPET
async function subscriptionsTwin(sl: SecondLayer) {
	return sl.subscriptions.create({
		name: "whale-alerts",
		triggers: [
			trigger.ftTransfer({
				assetIdentifier: SBTC_ASSET_IDENTIFIER,
				minAmount: 100_000_000, // ≥ 1 BTC
			}),
		],
		url: "https://hooks.example.com/sbtc",
	});
}

// SHELL_GETSTARTED_SNIPPET (the TypeScript lines)
function getStartedTwin() {
	const sl = new SecondLayerClient(); // anonymous, default base URL
	return sl.index.ftTransfers({ contractId: SBTC_CONTRACT_ID });
}

describe("home snippets", () => {
	test("compile-checked twins exist for every executable snippet", () => {
		expect(typeof streamsTwin).toBe("function");
		expect(typeof indexTwin).toBe("function");
		expect(typeof subgraphsTwin).toBe("function");
		expect(typeof subscriptionsTwin).toBe("function");
		expect(typeof getStartedTwin).toBe("function");
	});

	test("snippet strings reference the real method names", () => {
		expect(STREAMS_SNIPPET).toContain("sl.streams.consume({ cursor })");
		expect(STREAMS_SNIPPET).toContain("sl.streams.dumps.list()");
		expect(INDEX_SNIPPET).toContain("sl.index.ftTransfers.walk({");
		expect(INDEX_SNIPPET).toContain(
			'sl.index.events({ eventType: "ft_transfer", trait: "sip-010" })',
		);
		expect(SUBGRAPHS_SNIPPET).toContain(
			'sl.subgraphs.rows("sbtc-flows", "transfers", { limit: 3 })',
		);
		expect(SUBSCRIPTIONS_SNIPPET).toContain("sl.subscriptions.create({");
		expect(SUBSCRIPTIONS_SNIPPET).toContain("trigger.ftTransfer({");
		expect(CLI_SNIPPET).toContain("sl subgraphs query sbtc-flows transfers");
		expect(SHELL_GETSTARTED_SNIPPET).toContain("new SecondLayer()");
	});

	test("snippets use the real mainnet sBTC identifiers", () => {
		expect(INDEX_SNIPPET).toContain(SBTC_CONTRACT_ID);
		expect(SUBSCRIPTIONS_SNIPPET).toContain(SBTC_ASSET_IDENTIFIER);
	});
});
