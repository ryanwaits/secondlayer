/**
 * Homepage code snippets — the marketing copy for each capability section.
 *
 * Every snippet that can compile is mirrored as real, compiled code in
 * `home-snippets.test.ts`, so the SDK surface can't drift behind what the
 * homepage promises. If you change a snippet, change its twin in the test.
 * The `defineSubgraph`/testing snippets compile in `@secondlayer/subgraphs`
 * itself (this app doesn't depend on it); their twins assert method names.
 */

/** sBTC SIP-010 asset identifier (mainnet). */
export const SBTC_ASSET_IDENTIFIER =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";

/** Filters section — the `on` union, written once. */
export const FILTERS_SNIPPET = `import { on } from "@secondlayer/stacks/filters";

const whales = on.ftTransfer({
  assetIdentifier:
    "${SBTC_ASSET_IDENTIFIER}",
  minAmount: 100_000_000n, // ≥ 1 BTC
});`;

/** The four projection rows on the right of the filters section. */
export const FILTERS_PROJECTIONS = [
	{
		surface: "index",
		note: "same rows, one cursor",
		code: "sl.index.events.list(whales.toIndexParams({ limit: 50 }));",
	},
	{
		surface: "streams",
		note: "hold the tip, reorg-aware",
		code: "sl.streams.events.list(whales.toStreamsParams());",
	},
	{
		surface: "subscriptions",
		note: '100_000_000n → "100000000" — converted here, not at JSON.stringify',
		code: "sl.subscriptions.create({ triggers: [whales.toChainTrigger()], url });",
	},
] as const;

/** The member-gating row — a compile error, not an empty result. */
export const FILTERS_GATE_SNIPPET = `on.sbtcDeposit({}).toIndexParams();
// Property 'toIndexParams' does not exist. Subscriptions only.`;

/**
 * Typed-handlers section (V4 IDE shell). Rendered hand-tokenized so the
 * squiggle can sit inside the code; compile-checked in @secondlayer/subgraphs.
 * Kept here so the mirror test can assert the field names against the pane.
 */
export const TYPED_HANDLERS_SNIPPET = `import { marketplaceAbi } from "./marketplace.abi";

sources: {
  sale: {
    type: "contract_call",
    contractId: MARKETPLACE,
    functionName: "purchase-asset",
    abi: marketplaceAbi,
  },
},
handlers: {
  sale: (event, ctx) => ctx.insert("sales", {
    collection: event.input.collection,
    token_id:   event.input.tokenId,
    amount:     event.input.amount,
  }),
},`;

/**
 * The right pane of the IDE section: the ABI artifact the types come from —
 * the Clarity JSON ABI shape (`AbiFunction`: name/access/args) emitted by
 * contract codegen, frozen `as const` so the literals survive into types.
 */
export const TYPED_HANDLERS_ABI_SNIPPET = `// marketplace.abi.ts — generated from the deployed contract
export const marketplaceAbi = {
  functions: [{
    name: "purchase-asset",
    access: "public",
    args: [
      { name: "collection", type: "principal" },
      { name: "token-id",   type: "uint128" },
      { name: "price",      type: "uint128" },
    ],
    /* outputs … */
  }],
} as const;`;

/** Testing section — the unit-test half (left pane of the V3 shell). */
export const TESTING_SNIPPET = `import { buildEvent, createTestContext }
  from "@secondlayer/subgraphs/testing";

test("registers a name from a nested tuple", async () => {
  const ctx = createTestContext(bns.schema, {
    block: { height: 167_484 },
  });
  await bns.handlers.bns!(
    buildEvent(bns.sources.bns, {
      topic: "name-register", data,
    }),
    ctx,
  );
  expect(await ctx.rows("names")).toMatchInlineSnapshot();
});`;

/** Testing section — the `secondlayer subgraphs test` terminal transcript. */
export const TESTING_RUN = {
	cmd: "secondlayer subgraphs test subgraphs/bns-names.ts --from 167484 --to 167600",
	ok: "✓ 41 events matched · 41 rows written · 1.2s",
	cassette: "cassette: cassettes/bns-names.json",
	offlineCmd: "secondlayer subgraphs test subgraphs/bns-names.ts --offline",
	offlineOk: "✓ replayed cassette · 0 network calls",
	guardNote: "# and the bug this gate exists for:",
	guardErr: "✗ events matched, handlers wrote 0 rows",
	guardDetail: "a field-mapping bug — this subgraph would ship empty",
} as const;
