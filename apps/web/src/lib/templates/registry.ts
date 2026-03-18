export interface SubgraphTemplate {
  id: string;
  name: string;
  description: string;
  category: "defi" | "nft" | "token" | "infrastructure";
  code: string;
  prompt: string;
}

export const templates: SubgraphTemplate[] = [
  {
    id: "dex-swaps",
    name: "DEX Swap Tracking",
    description: "Track swap events from ALEX or any AMM pool. Indexes token pairs, amounts, and traders.",
    category: "defi",
    code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'dex-swaps',
  sources: [
    { contract: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01', event: 'swap' },
  ],
  schema: {
    swaps: {
      columns: {
        sender:   { type: 'principal', indexed: true },
        token_x:  { type: 'text' },
        token_y:  { type: 'text' },
        amount_x: { type: 'uint' },
        amount_y: { type: 'uint' },
      },
      indexes: [['sender', 'token_x']],
    },
  },
  handlers: {
    'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01::swap': (event, ctx) => {
      ctx.insert('swaps', {
        sender: ctx.tx.sender,
        token_x: event.tokenX,
        token_y: event.tokenY,
        amount_x: event.dx,
        amount_y: event.dy,
      });
    },
  },
});
`,
    prompt: "Create a Secondlayer subgraph that tracks DEX swap events from ALEX AMM pool. Index sender, token pairs, and amounts.",
  },
  {
    id: "nft-marketplace",
    name: "NFT Marketplace",
    description: "Index NFT listings, sales, and cancellations. Track prices and ownership changes.",
    category: "nft",
    code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'nft-marketplace',
  sources: [
    { contract: 'SP...marketplace', event: 'list-item' },
    { contract: 'SP...marketplace', event: 'unlist-item' },
    { contract: 'SP...marketplace', event: 'purchase' },
  ],
  schema: {
    listings: {
      columns: {
        nft_id:  { type: 'uint', indexed: true },
        seller:  { type: 'principal', indexed: true },
        price:   { type: 'uint' },
        status:  { type: 'text' },
      },
      uniqueKeys: [['nft_id']],
    },
    sales: {
      columns: {
        nft_id:  { type: 'uint', indexed: true },
        seller:  { type: 'principal' },
        buyer:   { type: 'principal', indexed: true },
        price:   { type: 'uint' },
      },
    },
  },
  handlers: {
    'SP...marketplace::list-item': (event, ctx) => {
      ctx.upsert('listings', { nft_id: event.nftId }, {
        nft_id: event.nftId,
        seller: ctx.tx.sender,
        price: event.price,
        status: 'active',
      });
    },
    'SP...marketplace::unlist-item': (event, ctx) => {
      ctx.update('listings', { nft_id: event.nftId }, { status: 'cancelled' });
    },
    'SP...marketplace::purchase': (event, ctx) => {
      ctx.update('listings', { nft_id: event.nftId }, { status: 'sold' });
      ctx.insert('sales', {
        nft_id: event.nftId,
        seller: event.seller,
        buyer: ctx.tx.sender,
        price: event.price,
      });
    },
  },
});
`,
    prompt: "Create a Secondlayer subgraph for an NFT marketplace. Track listings, cancellations, and sales with prices.",
  },
  {
    id: "token-transfers",
    name: "Token Transfers",
    description: "Track fungible token transfers with running balance computation per address.",
    category: "token",
    code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'token-transfers',
  sources: [
    { contract: 'SP...token', event: 'transfer' },
  ],
  schema: {
    transfers: {
      columns: {
        from_addr: { type: 'principal', indexed: true },
        to_addr:   { type: 'principal', indexed: true },
        amount:    { type: 'uint' },
      },
    },
    balances: {
      columns: {
        address: { type: 'principal', indexed: true },
        balance: { type: 'uint' },
      },
      uniqueKeys: [['address']],
    },
  },
  handlers: {
    'SP...token::transfer': async (event, ctx) => {
      ctx.insert('transfers', {
        from_addr: event.sender,
        to_addr: event.recipient,
        amount: event.amount,
      });

      // Update sender balance
      const senderBal = await ctx.findOne('balances', { address: event.sender });
      const senderPrev = senderBal ? BigInt(senderBal.balance as string) : 0n;
      ctx.upsert('balances', { address: event.sender }, {
        address: event.sender,
        balance: senderPrev - BigInt(event.amount as string),
      });

      // Update recipient balance
      const recipBal = await ctx.findOne('balances', { address: event.recipient });
      const recipPrev = recipBal ? BigInt(recipBal.balance as string) : 0n;
      ctx.upsert('balances', { address: event.recipient }, {
        address: event.recipient,
        balance: recipPrev + BigInt(event.amount as string),
      });
    },
  },
});
`,
    prompt: "Create a Secondlayer subgraph that tracks token transfers and computes running balances per address.",
  },
  {
    id: "bns-names",
    name: "BNS Names",
    description: "Index BNS name registrations and transfers. Search names by owner or namespace.",
    category: "infrastructure",
    code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'bns-names',
  sources: [
    { contract: 'SP000000000000000000002Q6VF78.bns', function: 'name-register' },
    { contract: 'SP000000000000000000002Q6VF78.bns', function: 'name-transfer' },
  ],
  schema: {
    names: {
      columns: {
        name:      { type: 'text', indexed: true, search: true },
        namespace: { type: 'text', indexed: true },
        owner:     { type: 'principal', indexed: true },
      },
      uniqueKeys: [['name', 'namespace']],
    },
    transfers: {
      columns: {
        name:      { type: 'text' },
        namespace: { type: 'text' },
        from_addr: { type: 'principal' },
        to_addr:   { type: 'principal' },
      },
    },
  },
  handlers: {
    'SP000000000000000000002Q6VF78.bns::name-register': (event, ctx) => {
      ctx.upsert('names', { name: event.name, namespace: event.namespace }, {
        name: event.name,
        namespace: event.namespace,
        owner: ctx.tx.sender,
      });
    },
    'SP000000000000000000002Q6VF78.bns::name-transfer': (event, ctx) => {
      ctx.update('names', { name: event.name, namespace: event.namespace }, {
        owner: event.newOwner,
      });
      ctx.insert('transfers', {
        name: event.name,
        namespace: event.namespace,
        from_addr: event.sender,
        to_addr: event.newOwner,
      });
    },
  },
});
`,
    prompt: "Create a Secondlayer subgraph for BNS name registrations and transfers on Stacks.",
  },
  {
    id: "stx-whales",
    name: "STX Whale Alerts",
    description: "Track large STX transfers above a configurable threshold. Great for monitoring whale activity.",
    category: "token",
    code: `import { defineSubgraph } from '@secondlayer/subgraphs';

const WHALE_THRESHOLD = 100_000_000_000; // 100k STX in microSTX

export default defineSubgraph({
  name: 'stx-whales',
  sources: [{ type: 'stx_transfer' }],
  schema: {
    whale_transfers: {
      columns: {
        sender:   { type: 'principal', indexed: true },
        receiver: { type: 'principal', indexed: true },
        amount:   { type: 'uint' },
      },
    },
  },
  handlers: {
    stx_transfer: (event, ctx) => {
      const amount = BigInt(event.amount as string);
      if (amount >= BigInt(WHALE_THRESHOLD)) {
        ctx.insert('whale_transfers', {
          sender: event.sender,
          receiver: event.recipient,
          amount: event.amount,
        });
      }
    },
  },
});
`,
    prompt: "Create a Secondlayer subgraph that tracks STX transfers above 100k STX as whale alerts.",
  },
];

export function getTemplateById(id: string): SubgraphTemplate | undefined {
  return templates.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: string): SubgraphTemplate[] {
  return templates.filter((t) => t.category === category);
}
