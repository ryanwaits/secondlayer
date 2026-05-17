/**
 * Subgraph scaffold templates.
 *
 * `sl subgraphs new <name>` — emits the basic blank.
 * `sl subgraphs new <name> --template <slug>` — emits a Foundation
 * Dataset–shaped starter that compiles + runs zero-config.
 *
 * Each template mirrors one of the public Foundation Datasets so that the
 * "I just used the dataset, now I want to write my own" path is a 1-line
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
 * numbered steps a new user follows after `sl subgraphs new`. Mirrors the
 * "30-minute quickstart" section in /docs/subgraphs.
 */
function nextStepsHeader(name: string): string {
	return `// ───────────────────────────────────────────────────────────────────
// What to do next
//
//   1. Edit the source filter + schema below to match what you want to track.
//   2. Edit the handler at the bottom — it runs once per matching event.
//   3. Deploy:   sl subgraphs deploy ${name}.ts
//      (You'll be prompted to log in if this is your first remote deploy.)
//   4. Wait for sync:   sl subgraphs status ${name}
//      Mainnet backfill from genesis can take an hour or more depending on
//      your filter scope. Use --start-block to skip ahead.
//   5. Query:    sl subgraphs query ${name} <table-name>
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
    handler: { type: "contract_call", contractId: "SP000000000000000000002Q6VF78.pox-4" },
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
      ctx.insert("data", {
        sender: ctx.tx.sender,
        amount: event.amount ?? 0,
        memo: null,
      });
    },
  },
});
`;
}

// ── sip-010-balances ──────────────────────────────────────────────────

function sip010Balances(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track SIP-010 token balances per (asset_identifier, holder).
 * Mirrors the shape of the Foundation Datasets sBTC token-events
 * surface — but works for ANY SIP-010 token. Constrain to a single
 * token by adding \`assetIdentifier: "SP...token::token-name"\` to each
 * source filter.
 *
 * Query examples once deployed:
 *   GET /api/subgraphs/${name}/balances?_search=SP1...
 *   GET /api/subgraphs/${name}/balances?holder=SP1...
 */
export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "Per-token balance tracking for any SIP-010 asset",

  sources: {
    transfer: { type: "ft_transfer" },
    mint: { type: "ft_mint" },
    burn: { type: "ft_burn" },
  },

  schema: {
    balances: {
      columns: {
        asset_identifier: { type: "text", indexed: true, search: true },
        holder: { type: "principal", indexed: true, search: true },
        amount: { type: "uint" },
      },
      uniqueKeys: [["asset_identifier", "holder"]],
    },
  },

  handlers: {
    transfer: async (event, ctx) => {
      const amount = BigInt(event.amount ?? 0);
      if (event.sender) {
        await adjust(ctx, event.assetIdentifier, event.sender, -amount);
      }
      if (event.recipient) {
        await adjust(ctx, event.assetIdentifier, event.recipient, amount);
      }
    },
    mint: async (event, ctx) => {
      if (event.recipient) {
        await adjust(ctx, event.assetIdentifier, event.recipient, BigInt(event.amount ?? 0));
      }
    },
    burn: async (event, ctx) => {
      if (event.sender) {
        await adjust(ctx, event.assetIdentifier, event.sender, -BigInt(event.amount ?? 0));
      }
    },
  },
});

async function adjust(
  // biome-ignore lint/suspicious/noExplicitAny: subgraph runtime ctx shape
  ctx: any,
  assetIdentifier: string,
  holder: string,
  delta: bigint,
): Promise<void> {
  const existing = await ctx.findOne("balances", { asset_identifier: assetIdentifier, holder });
  const current = existing ? BigInt(existing.amount) : 0n;
  const next = current + delta;
  await ctx.upsert(
    "balances",
    { asset_identifier: assetIdentifier, holder },
    { asset_identifier: assetIdentifier, holder, amount: next },
  );
}
`;
}

// ── sbtc-flows ────────────────────────────────────────────────────────

function sbtcFlows(name: string): string {
	return `import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track sBTC protocol flows: deposits, withdrawals, signer rotations,
 * governance updates. Mirrors the shape of the Foundation Datasets
 * \`/v1/datasets/sbtc/events\` surface but in your own subgraph.
 *
 * Source contract: sbtc-registry (mainnet).
 *
 * Query examples once deployed:
 *   GET /api/subgraphs/${name}/flows?topic=completed-deposit
 *   GET /api/subgraphs/${name}/flows?topic=withdrawal-create
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
      // biome-ignore lint/suspicious/noExplicitAny: print event shape varies by topic
      const e = event as any;
      const topic = typeof e.topic === "string" ? e.topic : null;
      if (!topic) return;
      const data = (e.data ?? {}) as Record<string, unknown>;

      ctx.insert("flows", {
        topic,
        request_id: data.requestId ?? null,
        amount: data.amount != null ? String(data.amount) : null,
        sender: (data.sender as string) ?? null,
        bitcoin_txid: (data.bitcoinTxid as string) ?? null,
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

/**
 * Track Stacking lifecycle calls on PoX-4 — solo stacking, delegation,
 * extension, increase, aggregation, signer-key authorizations. Mirrors
 * the shape of the Foundation Datasets \`/v1/datasets/pox-4/calls\`
 * surface as your own subgraph.
 *
 * Note: PoX-4 emits zero print events; this subgraph captures contract
 * calls. Decoding function args + raw_result is left to your handler —
 * the dataset shows one possible shape.
 *
 * Query examples once deployed:
 *   GET /api/subgraphs/${name}/calls?function_name=stack-stx
 *   GET /api/subgraphs/${name}/calls?caller=SP1...
 */
export default defineSubgraph({
  name: "${name}",
  version: "1.0.0",
  description: "PoX-4 stacking lifecycle calls",

  sources: {
    pox: {
      type: "contract_call",
      contractId: "SP000000000000000000002Q6VF78.pox-4",
    },
  },

  schema: {
    calls: {
      columns: {
        function_name: { type: "text", indexed: true, search: true },
        caller: { type: "principal", indexed: true, search: true },
        result_ok: { type: "boolean" },
      },
    },
  },

  handlers: {
    pox: (event, ctx) => {
      // biome-ignore lint/suspicious/noExplicitAny: contract_call event shape
      const fnName = (event as any).functionName ?? ctx.tx.functionName ?? "";
      // biome-ignore lint/suspicious/noExplicitAny: raw_result is hex-encoded Clarity
      const resultHex = (event as any).rawResult ?? "";
      ctx.insert("calls", {
        function_name: fnName,
        caller: ctx.tx.sender,
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
 * renewals, burns, airdrops. Mirrors the Foundation Datasets
 * \`/v1/datasets/bns/name-events\` surface as your own subgraph.
 *
 * Source: BNS-V2 print events (topic-discriminated payloads).
 *
 * Query examples once deployed:
 *   GET /api/subgraphs/${name}/names?owner=SP1...
 *   GET /api/subgraphs/${name}/names?_search=alice
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
      // biome-ignore lint/suspicious/noExplicitAny: print event shape
      const e = event as any;
      const topic = typeof e.topic === "string" ? e.topic : null;
      if (!topic) return;
      const data = (e.data ?? {}) as Record<string, unknown>;
      const namespace = decodeBuffUtf8(data.namespace);
      const nameLabel = decodeBuffUtf8(data.name);
      if (!namespace || !nameLabel) return;
      ctx.insert("names", {
        topic,
        namespace,
        name: nameLabel,
        fqn: \`\${nameLabel}.\${namespace}\`,
        owner: topic === "burn-name" ? null : ((data.owner as string) ?? null),
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
