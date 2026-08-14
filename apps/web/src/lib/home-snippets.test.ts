import { describe, expect, test } from "bun:test";
import type { SecondLayer } from "@secondlayer/sdk";
import { on } from "@secondlayer/stacks/filters";
import {
	FILTERS_GATE_SNIPPET,
	FILTERS_PROJECTIONS,
	FILTERS_SNIPPET,
	SBTC_ASSET_IDENTIFIER,
	TESTING_RUN,
	TESTING_SNIPPET,
	TYPED_HANDLERS_ABI_SNIPPET,
	TYPED_HANDLERS_SNIPPET,
} from "./home-snippets";

// Compile-checked twins of the homepage snippets. These are never executed
// (no network) — they exist so `tsc --noEmit` fails the moment the SDK surface
// drifts from what the homepage promises. Keep each twin in sync with its
// string constant in home-snippets.ts.

// FILTERS_SNIPPET + FILTERS_PROJECTIONS: one filter, three surfaces.
async function filtersTwin(sl: SecondLayer, url: string) {
	const whales = on.ftTransfer({
		assetIdentifier: SBTC_ASSET_IDENTIFIER,
		// the snippet shows `100_000_000n`; this app targets ES2017, where
		// bigint literals don't parse — BigInt() is the same value and type
		minAmount: BigInt(100_000_000), // ≥ 1 BTC
	});

	await sl.index.events.list(whales.toIndexParams({ limit: 50 }));
	await sl.streams.events.list(whales.toStreamsParams());
	await sl.subscriptions.create({
		name: "whale-alerts",
		triggers: [whales.toChainTrigger()],
		url,
	});
}

// FILTERS_GATE_SNIPPET: the homepage promises this is a COMPILE error, so the
// twin proves it stays one. If the projection ever appears on the member,
// the expect-error goes stale and tsc fails.
function filtersGateTwin() {
	// @ts-expect-error — sbtc_deposit is a Subscriptions-only member:
	// toIndexParams must not exist on its filter.
	return on.sbtcDeposit({}).toIndexParams();
}

// TYPED_HANDLERS_SNIPPET and TESTING_SNIPPET are `@secondlayer/subgraphs`
// surface (defineSubgraph abi typing, createTestContext). This app doesn't
// depend on that package; both compile as type-tests inside it. Here we pin
// the method names so a rename breaks this suite.

describe("home snippets", () => {
	test("compile-checked twins exist for every executable snippet", () => {
		expect(typeof filtersTwin).toBe("function");
		expect(typeof filtersGateTwin).toBe("function");
	});

	test("filter snippet and projections reference the real surface", () => {
		expect(FILTERS_SNIPPET).toContain(
			'import { on } from "@secondlayer/stacks/filters"',
		);
		expect(FILTERS_SNIPPET).toContain("on.ftTransfer({");
		expect(FILTERS_SNIPPET).toContain("minAmount: 100_000_000n");
		const codes = FILTERS_PROJECTIONS.map((p) => p.code).join("\n");
		expect(codes).toContain("whales.toIndexParams({ limit: 50 })");
		expect(codes).toContain("whales.toStreamsParams()");
		expect(codes).toContain("triggers: [whales.toChainTrigger()]");
		expect(FILTERS_GATE_SNIPPET).toContain(
			"Property 'toIndexParams' does not exist",
		);
	});

	test("subgraphs-package snippets name the real exports", () => {
		expect(TYPED_HANDLERS_SNIPPET).toContain('type: "contract_call"');
		expect(TYPED_HANDLERS_SNIPPET).toContain("abi: marketplaceAbi");
		expect(TYPED_HANDLERS_SNIPPET).toContain("event.input.");
		// The ABI pane must stay the real Clarity JSON ABI shape (AbiFunction:
		// name/access/args) and keep the const assertion the typing relies on.
		expect(TYPED_HANDLERS_ABI_SNIPPET).toContain('name: "purchase-asset"');
		expect(TYPED_HANDLERS_ABI_SNIPPET).toContain('access: "public"');
		expect(TYPED_HANDLERS_ABI_SNIPPET).toContain("as const");
		expect(TESTING_SNIPPET).toContain('from "@secondlayer/subgraphs/testing"');
		expect(TESTING_SNIPPET).toContain("createTestContext(");
		expect(TESTING_SNIPPET).toContain("buildEvent(");
		expect(TESTING_RUN.cmd).toContain("secondlayer subgraphs test");
	});

	test("snippets use the real mainnet sBTC identifiers", () => {
		expect(FILTERS_SNIPPET).toContain(SBTC_ASSET_IDENTIFIER);
	});
});
