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
		description:
			"Track swap events from ALEX or any AMM pool. Indexes token pairs, amounts, and traders.",
		category: "defi",
		code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'dex-swaps',
  sources: {
    swap: { type: 'print_event', contractId: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01', topic: 'swap' },
  },
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
    swap: (event, ctx) => {
      ctx.insert('swaps', {
        sender: ctx.tx.sender,
        token_x: event.data.tokenX,
        token_y: event.data.tokenY,
        amount_x: event.data.dx,
        amount_y: event.data.dy,
      });
    },
  },
});
`,
		prompt:
			"Create a Secondlayer subgraph that tracks DEX swap events from ALEX AMM pool. Index sender, token pairs, and amounts.",
	},
	{
		id: "nft-marketplace",
		name: "NFT Marketplace",
		description:
			"Index NFT listings, sales, and cancellations. Track prices and ownership changes.",
		category: "nft",
		code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'nft-marketplace',
  sources: {
    listItem: { type: 'print_event', contractId: 'SP...marketplace', topic: 'list-item' },
    unlistItem: { type: 'print_event', contractId: 'SP...marketplace', topic: 'unlist-item' },
    purchase: { type: 'print_event', contractId: 'SP...marketplace', topic: 'purchase' },
  },
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
    listItem: (event, ctx) => {
      ctx.upsert('listings', { nft_id: event.data.nftId }, {
        nft_id: event.data.nftId,
        seller: ctx.tx.sender,
        price: event.data.price,
        status: 'active',
      });
    },
    unlistItem: (event, ctx) => {
      ctx.update('listings', { nft_id: event.data.nftId }, { status: 'cancelled' });
    },
    purchase: (event, ctx) => {
      ctx.update('listings', { nft_id: event.data.nftId }, { status: 'sold' });
      ctx.insert('sales', {
        nft_id: event.data.nftId,
        seller: event.data.seller,
        buyer: ctx.tx.sender,
        price: event.data.price,
      });
    },
  },
});
`,
		prompt:
			"Create a Secondlayer subgraph for an NFT marketplace. Track listings, cancellations, and sales with prices.",
	},
	{
		id: "token-transfers",
		name: "Token Transfers",
		description:
			"Track fungible token transfers with running balance computation per address.",
		category: "token",
		code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'token-transfers',
  sources: {
    transfer: { type: 'ft_transfer', assetIdentifier: 'SP...token' },
  },
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
    transfer: async (event, ctx) => {
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
        balance: senderPrev - event.amount,
      });

      // Update recipient balance
      const recipBal = await ctx.findOne('balances', { address: event.recipient });
      const recipPrev = recipBal ? BigInt(recipBal.balance as string) : 0n;
      ctx.upsert('balances', { address: event.recipient }, {
        address: event.recipient,
        balance: recipPrev + event.amount,
      });
    },
  },
});
`,
		prompt:
			"Create a Secondlayer subgraph that tracks token transfers and computes running balances per address.",
	},
	{
		id: "bns-names",
		name: "BNS Names",
		description:
			"Index BNS name registrations and transfers. Search names by owner or namespace.",
		category: "infrastructure",
		code: `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: 'bns-names',
  sources: {
    nameRegister: { type: 'contract_call', contractId: 'SP000000000000000000002Q6VF78.bns', functionName: 'name-register' },
    nameTransfer: { type: 'contract_call', contractId: 'SP000000000000000000002Q6VF78.bns', functionName: 'name-transfer' },
  },
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
    nameRegister: (event, ctx) => {
      ctx.upsert('names', { name: event.args.name, namespace: event.args.namespace }, {
        name: event.args.name,
        namespace: event.args.namespace,
        owner: ctx.tx.sender,
      });
    },
    nameTransfer: (event, ctx) => {
      ctx.update('names', { name: event.args.name, namespace: event.args.namespace }, {
        owner: event.args.newOwner,
      });
      ctx.insert('transfers', {
        name: event.args.name,
        namespace: event.args.namespace,
        from_addr: event.args.sender,
        to_addr: event.args.newOwner,
      });
    },
  },
});
`,
		prompt:
			"Create a Secondlayer subgraph for BNS name registrations and transfers on Stacks.",
	},
	{
		id: "stx-whales",
		name: "STX Whale Alerts",
		description:
			"Track large STX transfers above a configurable threshold. Great for monitoring whale activity.",
		category: "token",
		code: `import { defineSubgraph } from '@secondlayer/subgraphs';

const WHALE_THRESHOLD = 100_000_000_000n; // 100k STX in microSTX

export default defineSubgraph({
  name: 'stx-whales',
  sources: {
    stxTransfer: { type: 'stx_transfer' },
  },
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
    stxTransfer: (event, ctx) => {
      if (event.amount >= WHALE_THRESHOLD) {
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
		prompt:
			"Create a Secondlayer subgraph that tracks STX transfers above 100k STX as whale alerts.",
	},
];

export function getTemplateById(id: string): SubgraphTemplate | undefined {
	return templates.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: string): SubgraphTemplate[] {
	return templates.filter((t) => t.category === category);
}
