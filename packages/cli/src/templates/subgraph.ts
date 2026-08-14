/**
 * Subgraph scaffold templates.
 *
 * `secondlayer subgraphs create <name>` — emits the basic blank.
 * `secondlayer subgraphs create <name> --template <slug>` — emits a starter that
 * compiles + runs zero-config.
 *
 * Each template mirrors a curated public subgraph so that the
 * "I just queried it, now I want my own schema" path is a 1-line
 * scaffold + minor edits.
 */

export const SUBGRAPH_TEMPLATE_SLUGS = [
	"basic",
	"sip-010-balances",
	"sbtc-flows",
	"pox-stacking",
	"bns-names",
] as const;

export type SubgraphTemplateSlug = (typeof SUBGRAPH_TEMPLATE_SLUGS)[number];

export const SUBGRAPH_TEMPLATE_DESCRIPTIONS: Record<
	SubgraphTemplateSlug,
	string
> = {
	basic: "Empty starter — pick any source filter type",
	"sip-010-balances": "SIP-010 token balances (transfers + mints + burns)",
	"sbtc-flows": "sBTC protocol flows (deposits, withdrawals, signer rotations)",
	"pox-stacking": "PoX-4 stacking lifecycle calls",
	"bns-names": "BNS-V2 name ownership and lifecycle",
};

export function generateSubgraphTemplate(
	name: string,
	slug: SubgraphTemplateSlug = "basic",
): string {
	const body = (() => {
		switch (slug) {
			case "sip-010-balances":
				return sip010Balances(name);
			case "sbtc-flows":
				return sbtcFlows(name);
			case "pox-stacking":
				return poxStacking(name);
			case "bns-names":
				return bnsNames(name);
			default:
				return basic(name);
		}
	})();
	return `${nextStepsHeader(name)}\n${body}`;
}

/**
 * Header comment shown at the top of every scaffolded subgraph file. Five
 * numbered steps a new user follows after `secondlayer subgraphs create`. Mirrors the
 * "30-minute quickstart" section in /docs/subgraphs.
 */
function nextStepsHeader(name: string): string {
	return `// ───────────────────────────────────────────────────────────────────
// What to do next
//
//   1. Edit the source filter + schema below to match what you want to track.
//   2. Edit the handler at the bottom — it runs once per matching event.
//   3. Deploy:   secondlayer subgraphs deploy ${name}.ts
//      (You'll be prompted to log in if this is your first remote deploy.)
//   4. Wait for sync:   secondlayer subgraphs status ${name}
//      Mainnet backfill from genesis can take an hour or more depending on
//      your filter scope. Use --start-block to skip ahead.
//   5. Query:    secondlayer subgraphs query ${name} <table-name>
//      Or hit the auto-generated REST endpoint listed in the deploy output.
//
// Bind a typed Subscription to any table you write here — see
// https://www.secondlayer.tools/docs/subscriptions
// ───────────────────────────────────────────────────────────────────

`;
}

// ── basic ─────────────────────────────────────────────────────────────

function basic(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "TODO: describe what this subgraph tracks",

  // Sources define what blockchain data this subgraph processes.
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

// ── sip-010-balances ──────────────────────────────────────────────────

function sip010Balances(name: string): string {
	return `import { defineSchema, defineSubgraph, readContractAt, type TypedSubgraphContext } from "@secondlayer/subgraphs";

/**
 * Track SIP-010 token balances per (asset_identifier, holder).
 * Mirrors the shape of the curated sBTC token-events view
 * surface — but works for ANY SIP-010 token. Constrain to a single
 * token by adding \`assetIdentifier: "SP...token::token-name"\` to each
 * source filter.
 *
 * Balances are moved with \`ctx.increment\`, which applies a DELTA in one
 * atomic statement. That matters: a read-modify-write (findOne → compute →
 * upsert) loses concurrent updates to the same row, and it is not replay-safe
 * under \`backfillMode: "concurrent"\`. Deltas commute, so order doesn't
 * matter and a reorg rewind reverses cleanly via the journal.
 *
 * Token metadata (decimals/symbol) comes from the token contract itself via
 * \`readContractAt\`, so \`amount\` stops being a bare integer nobody can
 * render. The read is pinned to the block being processed — a handler stays a
 * pure function of its block — and \`cache: "contract-constant"\` says these
 * two values can never change for a given token, so each is fetched ONCE
 * instead of once per block.
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/${name}/balances?_search=SP1...
 *   GET /v1/subgraphs/${name}/balances?holder=SP1...
 *   GET /v1/subgraphs/${name}/tokens
 */

/** The two SIP-010 read-only functions this subgraph calls. */
const SIP010_ABI = {
  functions: [
    { name: "get-decimals", access: "read-only", args: [], outputs: { response: { ok: "uint128", error: "uint128" } } },
    { name: "get-symbol", access: "read-only", args: [], outputs: { response: { ok: { "string-ascii": { length: 32 } }, error: "uint128" } } },
  ],
} as const;

/** Tokens already labelled in this process — metadata is immutable, so one
 *  resolution per token is enough even across a backfill. */
const labelled = new Set<string>();

// Hoisted so the helper below can be typed against it.
const schema = defineSchema({
  balances: {
    columns: {
      asset_identifier: { type: "text", indexed: true, search: true },
      holder: { type: "principal", indexed: true, search: true },
      amount: { type: "uint" },
    },
    // increment() upserts on this key.
    uniqueKeys: [["asset_identifier", "holder"]],
  },
  tokens: {
    columns: {
      asset_identifier: { type: "text", indexed: true },
      contract_id: { type: "text" },
      symbol: { type: "text" },
      decimals: { type: "uint" },
    },
    uniqueKeys: [["asset_identifier"]],
  },
});

export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "Per-token balance tracking for any SIP-010 asset",

  sources: {
    transfer: { type: "ft_transfer" },
    mint: { type: "ft_mint" },
    burn: { type: "ft_burn" },
  },

  schema,

  handlers: {
    transfer: async (event, ctx) => {
      await labelToken(event.assetIdentifier, ctx);
      const amount = BigInt(event.amount ?? 0);
      if (event.sender) {
        ctx.increment("balances", { asset_identifier: event.assetIdentifier, holder: event.sender }, { amount: -amount });
      }
      if (event.recipient) {
        ctx.increment("balances", { asset_identifier: event.assetIdentifier, holder: event.recipient }, { amount });
      }
    },
    mint: (event, ctx) => {
      if (event.recipient) {
        ctx.increment("balances", { asset_identifier: event.assetIdentifier, holder: event.recipient }, { amount: BigInt(event.amount ?? 0) });
      }
    },
    burn: (event, ctx) => {
      if (event.sender) {
        ctx.increment("balances", { asset_identifier: event.assetIdentifier, holder: event.sender }, { amount: -BigInt(event.amount ?? 0) });
      }
    },
  },
});

/** Resolve a token's symbol + decimals from its contract, once. */
async function labelToken(
  assetIdentifier: string | undefined,
  ctx: TypedSubgraphContext<typeof schema>,
) {
  if (!assetIdentifier || labelled.has(assetIdentifier)) return;
  labelled.add(assetIdentifier);
  const contractId = assetIdentifier.split("::")[0];
  const token = readContractAt(ctx, contractId, SIP010_ABI, { cache: "contract-constant" });
  const [decimals, symbol] = await Promise.all([
    token.read.getDecimals({}),
    token.read.getSymbol({}),
  ]);
  ctx.upsert("tokens", { asset_identifier: assetIdentifier }, { asset_identifier: assetIdentifier, contract_id: contractId, symbol, decimals });
}
`;
}

// ── sbtc-flows ────────────────────────────────────────────────────────

function sbtcFlows(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track sBTC protocol flows: deposits, withdrawals, signer rotations,
 * governance updates — your own indexed view of the sbtc-registry contract.
 *
 * Source contract: sbtc-registry (mainnet).
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/${name}/flows?topic=completed-deposit
 *   GET /v1/subgraphs/${name}/flows?topic=withdrawal-create
 */
export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "sBTC deposits, withdrawals, signer rotations, governance",

  // Skip pre-sBTC history. Raise this (e.g., to a recent block near tip) for
  // a smaller backfill, or lower it if you need every sBTC event from genesis.
  startBlock: 860000,

  sources: {
    registry: {
      type: "print_event",
      contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
    },
  },

  schema: {
    flows: {
      columns: {
        topic: { type: "text", indexed: true, search: true },
        request_id: { type: "uint", nullable: true, indexed: true },
        amount: { type: "text", nullable: true },
        sender: { type: "principal", nullable: true, indexed: true },
        bitcoin_txid: { type: "text", nullable: true, search: true },
        burn_height: { type: "uint", nullable: true },
      },
    },
  },

  handlers: {
    registry: (event, ctx) => {
      if (!event.topic) return;
      // event.data is untyped across topics — cast to the fields you read, or
      // declare \`prints\` per topic on the source for fully typed event.data.
      const data = event.data as {
        requestId?: bigint;
        amount?: bigint | string;
        sender?: string;
        bitcoinTxid?: string;
        burnHeight?: bigint;
      };
      ctx.insert("flows", {
        topic: event.topic,
        request_id: data.requestId ?? null,
        amount: data.amount != null ? String(data.amount) : null,
        sender: data.sender ?? null,
        bitcoin_txid: data.bitcoinTxid ?? null,
        burn_height: data.burnHeight ?? null,
      });
    },
  },
});
`;
}

// ── pox-stacking ──────────────────────────────────────────────────────

function poxStacking(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";
import { POX5_ABI } from "@secondlayer/stacks/pox5";

/**
 * Track PoX-5 \`stake\` calls with their arguments already decoded.
 *
 * pox-5 replaced pox-4 when Epoch 4.0 activated (Bitcoin block 960,230,
 * 2026-07-30). SIP-045 reshaped the API: stacking became bonds + staking, so
 * the entry point is \`stake\`, not \`stack-stx\`.
 *
 * The source pairs \`abi\` with \`functionName\`, which is what makes
 * \`event.input\` a typed, named argument set instead of positional
 * \`args[0] as bigint\`. Add one source per function you want to track.
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/${name}/calls?caller=SP1...
 *   GET /v1/subgraphs/${name}/calls?caller=SP1...
 */
export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "PoX-5 stake calls with decoded arguments",

  sources: {
    pox: {
      type: "contract_call",
      // pox-5 is the live PoX contract since Epoch 4.0 activated at Bitcoin
      // block 960,230 (2026-07-30). Stacking history before that is pox-4 —
      // point a second source at \`.pox-4\` if you need it.
      contractId: "SP000000000000000000002Q6VF78.pox-5",
      // \`abi\` + \`functionName\` together are what type \`event.input\`: the
      // arguments cannot be typed without knowing which function was called.
      // POX5_ABI ships \`as const\` in @secondlayer/stacks, so there is no
      // hand-copied ABI to drift. Add a source per function you care about.
      functionName: "stake",
      abi: POX5_ABI,
    },
  },

  schema: {
    calls: {
      columns: {
        function_name: { type: "text", indexed: true, search: true },
        caller: { type: "principal", indexed: true, search: true },
        amount_ustx: { type: "uint" },
        num_cycles: { type: "uint" },
        result_ok: { type: "boolean" },
      },
    },
  },

  handlers: {
    pox: (event, ctx) => {
      // \`event.input\` is the decoded, named, typed argument set — no
      // \`args[0] as bigint\`. Hover \`amountUstx\` and it is a bigint.
      const resultHex = event.resultHex ?? "";
      ctx.insert("calls", {
        function_name: event.functionName || ctx.tx.functionName || "",
        caller: ctx.tx.sender,
        amount_ustx: event.input.amountUstx,
        num_cycles: event.input.numCycles,
        result_ok: resultHex.startsWith("0x07"), // 0x07 = response-ok type tag
      });
    },
  },
});
`;
}

// ── bns-names ─────────────────────────────────────────────────────────

function bnsNames(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track BNS-V2 name lifecycle events — registrations, transfers,
 * renewals, burns, airdrops.
 *
 * Source: BNS-V2 print events (topic-discriminated payloads).
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/${name}/names?owner=SP1...
 *   GET /v1/subgraphs/${name}/names?_search=alice
 */
export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "BNS-V2 name ownership and lifecycle",

  sources: {
    bns: {
      type: "print_event",
      contractId: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
    },
  },

  schema: {
    names: {
      columns: {
        topic: { type: "text", indexed: true },
        namespace: { type: "text", indexed: true, search: true },
        name: { type: "text", indexed: true, search: true },
        fqn: { type: "text", indexed: true, search: true },
        owner: { type: "principal", nullable: true, indexed: true, search: true },
      },
    },
  },

  handlers: {
    bns: (event, ctx) => {
      if (!event.topic) return;
      const data = event.data as { namespace?: unknown; name?: unknown; owner?: string };
      const namespace = decodeBuffUtf8(data.namespace);
      const nameLabel = decodeBuffUtf8(data.name);
      if (!namespace || !nameLabel) return;
      ctx.insert("names", {
        topic: event.topic,
        namespace,
        name: nameLabel,
        fqn: \`\${nameLabel}.\${namespace}\`,
        owner: event.topic === "burn-name" ? null : (data.owner ?? null),
      });
    },
  },
});

function decodeBuffUtf8(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length === 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
}
`;
}
