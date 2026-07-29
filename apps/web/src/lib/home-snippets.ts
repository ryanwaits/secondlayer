/**
 * Homepage code snippets — the marketing copy for each product surface.
 *
 * Every TypeScript snippet here is mirrored as real, compiled code in
 * `home-snippets.test.ts`, so the SDK surface can't drift behind what the
 * homepage promises. If you change a snippet, change its twin in the test.
 */

/** sBTC token contract (mainnet). */
export const SBTC_CONTRACT_ID =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

/** sBTC protocol registry contract (mainnet) — the peg-event emitter. */
export const SBTC_REGISTRY_CONTRACT_ID =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry";

/** sBTC SIP-010 asset identifier (mainnet). */
export const SBTC_ASSET_IDENTIFIER =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";

export const STREAMS_SNIPPET = `// resume the firehose from your cursor
for await (const batch of sl.streams.consume({ cursor })) {
  await handle(batch.events); // ordered, reorg-aware
}

// or bulk history from signed dumps
const dumps = await sl.streams.dumps.list();`;

export const INDEX_SNIPPET = `// sweep sBTC into your own tables — resumable, reorg-aware
await sl.index.events.consume({
  eventType: "ft_transfer",           // narrows rows to ft_transfer
  contractId: [                       // one cursor, both contracts
    "${SBTC_CONTRACT_ID}",
    "${SBTC_REGISTRY_CONTRACT_ID}",
  ],
  fromCursor: await loadCheckpoint(), // null on first run
  onBatch: async (transfers, _envelope, ctx) => {
    for (const t of transfers) await save(t); // typed: sender, amount
    return ctx.cursor;                        // commits with your rows
  },
  onReorg: async (r) => rollbackFrom(r.fork_point_height),
});

// or just read — keyless, by contract or trait
await sl.index.events({ eventType: "ft_transfer", trait: "sip-010" });`;

export const SUBGRAPHS_SNIPPET = `export default defineSubgraph({
  name: "sbtc-flows",
  sources: { transfer: { type: "ft_transfer",
    assetIdentifier: "${SBTC_ASSET_IDENTIFIER}" } },
  schema: {
    transfers: { columns: {
      sender:    { type: "principal", indexed: true },
      recipient: { type: "principal", indexed: true },
      amount:    { type: "uint" } } },
    balances: {
      columns: {
        address: { type: "principal" },
        balance: { type: "uint" } },
      uniqueKeys: [["address"]] },
  },
  handlers: { transfer: async (e, ctx) => { /* ... */ } },
});

// query it back — anonymous read on public subgraphs
const { rows } = await sl.subgraphs.rows("sbtc-flows", "transfers", { limit: 3 });`;

export const SUBSCRIPTIONS_SNIPPET = `await sl.subscriptions.create({
  name: "whale-alerts",
  triggers: [trigger.ftTransfer({
    assetIdentifier: "${SBTC_ASSET_IDENTIFIER}",
    minAmount: 100_000_000, // ≥ 1 BTC
  })],
  url: "https://hooks.example.com/sbtc",
});`;

export const CLI_SNIPPET = `# contract → subgraph in one line
sl subgraphs scaffold ${SBTC_CONTRACT_ID} -o sbtc.ts

# deploy + watch it sync
sl subgraphs deploy sbtc.ts
sl subgraphs status sbtc-flows

# query from the shell, pipe to jq
sl subgraphs query sbtc-flows transfers --limit 3 --json`;

export const SHELL_GETSTARTED_SNIPPET = `npm install @secondlayer/sdk

// first query — anonymous, no key
const sl = new SecondLayer();
await sl.index.ftTransfers({
  contractId: "${SBTC_CONTRACT_ID}",
});

# deploy your own view when ready
bun add -g @secondlayer/cli
sl subgraphs deploy my-view.ts`;
