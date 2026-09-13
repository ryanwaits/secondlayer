import { defineConfig } from "vocs";

export default defineConfig({
	title: "stacks",
	description: "Typed Stacks client for TypeScript. By secondlayer.",
	sidebar: [
		{
			text: "Getting started",
			items: [
				{ text: "Introduction", link: "/" },
				{ text: "Getting started", link: "/getting-started" },
			],
		},
		{
			text: "Guides",
			items: [
				{ text: "Transactions", link: "/guide/transactions" },
				{ text: "Bitcoin SPV", link: "/guide/bitcoin-spv" },
				{ text: "PoX-5", link: "/guide/pox5" },
				{ text: "Clarinet simnet", link: "/guide/simnet" },
				{ text: "Fee tiers", link: "/guide/fees" },
				{ text: "Wait for confirmation", link: "/guide/confirmation" },
				{ text: "Errors", link: "/guide/errors" },
				{ text: "Bitcoin addresses", link: "/guide/bitcoin-addresses" },
				{ text: "Nonces", link: "/guide/nonces" },
				{ text: "WalletConnect", link: "/guide/walletconnect" },
			],
		},
		{
			text: "Reference",
			items: [
				{ text: "accounts", link: "/reference/accounts" },
				{ text: "actions", link: "/reference/actions" },
				{ text: "bitcoin", link: "/reference/bitcoin" },
				{ text: "bns", link: "/reference/bns" },
				{ text: "chains", link: "/reference/chains" },
				{ text: "clarity", link: "/reference/clarity" },
				{ text: "connect", link: "/reference/connect" },
				{
					text: "connect/walletconnect",
					link: "/reference/connect-walletconnect",
				},
				{ text: "filters", link: "/reference/filters" },
				{ text: "postconditions", link: "/reference/postconditions" },
				{ text: "pox", link: "/reference/pox" },
				{ text: "pox5", link: "/reference/pox5" },
				{ text: "sbtc", link: "/reference/sbtc" },
				{ text: "simnet", link: "/reference/simnet" },
				{ text: "stackingdao", link: "/reference/stackingdao" },
				{ text: "subscriptions", link: "/reference/subscriptions" },
				{ text: "tools", link: "/reference/tools" },
				{ text: "tools/btc", link: "/reference/tools-btc" },
				{ text: "transactions", link: "/reference/transactions" },
				{ text: "utils", link: "/reference/utils" },
			],
		},
	],
	topNav: [
		{ text: "Docs", link: "/" },
		{
			text: "GitHub",
			link: "https://github.com/ryanwaits/secondlayer/tree/main/packages/stacks",
		},
	],
});
