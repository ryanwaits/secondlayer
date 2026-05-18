// Query a deployed subgraph from your app via @secondlayer/sdk.
//
// Two flavors:
//   1. Untyped: `sl.subgraphs.queryTable(name, table, params)` — works for any subgraph.
//   2. Typed:   `sl.subgraphs.typed(definition)` — full inference if you have
//      the original `defineSubgraph` module in scope.
//
// Run:  bun examples/sdk-query-subgraph.ts

import { SecondLayer } from "@secondlayer/sdk";
import mySubgraph from "./minimal-subgraph";

const sl = new SecondLayer({
  // API key NOT required for queries in open beta.
  apiKey: process.env.SECONDLAYER_API_KEY,
});

// --- Untyped query ---

const rows = await sl.subgraphs.queryTable("stx-transfers", "transfers", {
  sort: "_block_height",
  order: "desc",
  limit: 25,
  filters: {
    "amount.gte": "1000000000", // 1000 STX in microSTX
  },
});
console.log(`Found ${rows.length} whale transfers`);

const { count } = await sl.subgraphs.queryTableCount("stx-transfers", "transfers", {
  filters: { sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7" },
});
console.log(`That sender has sent in ${count} transfers total`);

// --- Typed query (full inference) ---

const typed = sl.subgraphs.typed(mySubgraph);

// `transfers` table is inferred from mySubgraph.schema. Columns are typed.
const recent = await typed.transfers.findMany({
  where: {
    amount: { gte: 1_000_000n }, // bigint, matches column type
  },
  orderBy: { blockHeight: "desc" },
  limit: 10,
});

for (const t of recent) {
  console.log(`${t.sender} -> ${t.recipient}: ${t.amount}`);
}
