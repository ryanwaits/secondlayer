/**
 * The empty starter emitted by `secondlayer subgraphs create <name>` when no
 * `--from-contract` is given.
 *
 * Deliberately ONE starter, and deliberately a single inline object literal:
 * `defineSubgraph()` metadata is read by AST extraction that never executes
 * user code (`packages/bundler/src/extract.ts`), so hoisted consts and helper
 * calls in the definition do not survive deploy. Keep it flat.
 */
export function generateSubgraphStarter(name: string): string {
	return `${nextStepsHeader(name)}${starter(name)}`;
}

/** Header comment at the top of every scaffolded subgraph file. */
function nextStepsHeader(name: string): string {
	return `// ───────────────────────────────────────────────────────────────────
// What to do next
//
//   1. Edit the source filter + schema below to match what you want to track.
//   2. Edit the handler at the bottom — it runs once per matching event.
//   3. Deploy:   secondlayer subgraphs deploy ${name}.ts
//   4. Wait for sync:   secondlayer subgraphs status ${name}
//      Backfill from genesis can take an hour or more depending on your
//      filter scope. Use --start-block to skip ahead.
//   5. Query:    secondlayer subgraphs query ${name} <table-name>
//      Or hit the REST endpoint listed in the deploy output.
//
// Prefer generating from a real contract:
//   secondlayer subgraphs create ${name} --from-contract SP....my-contract
// ───────────────────────────────────────────────────────────────────

`;
}

function starter(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "TODO: describe what this subgraph tracks",

  // Sources define what chain data this subgraph processes.
  // Each source is named — the name becomes the handler key.
  //
  // Filter types:
  //   { type: "ft_transfer", assetIdentifier: "SP...token::token-name" }
  //   { type: "ft_mint", assetIdentifier: "SP...token::token-name" }
  //   { type: "contract_call", contractId: "SP...contract", functionName: "swap" }
  //   { type: "contract_deploy" }
  //   { type: "print_event", contractId: "SP...contract", topic: "my-event" }
  //   { type: "stx_transfer", minAmount: 1000000n }
  //   { type: "nft_transfer", assetIdentifier: "SP...nft::nft-name" }
  sources: {
    handler: { type: "ft_transfer" },
  },

  // Schema defines the tables this subgraph creates.
  // Each table gets auto-columns: _id, _block_height, _tx_id, _created_at.
  // Column types: text, uint, int, principal, boolean, timestamp, jsonb
  schema: {
    data: {
      columns: {
        sender: { type: "principal", indexed: true },
        amount: { type: "uint" },
        memo: { type: "text", nullable: true },
      },
    },
  },

  // Handlers process matched events. Keys must match source names.
  // Context: ctx.insert(), ctx.update(), ctx.upsert(), ctx.patch(),
  //          ctx.patchOrInsert(), ctx.findOne(), ctx.findMany()
  handlers: {
    handler: (event, ctx) => {
      // event is typed from the source — for ft_transfer: sender, recipient,
      // amount (bigint), assetIdentifier. ctx.insert is checked against schema.
      ctx.insert("data", {
        sender: event.sender,
        amount: event.amount,
        memo: null,
      });
    },
  },
});
`;
}
