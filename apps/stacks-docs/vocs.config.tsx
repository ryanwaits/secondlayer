import { defineConfig } from "vocs";
import { stacksGold, stacksGoldDark } from "./docs/syntax-theme";

/* Grounds + ink. Light = egg white, dark = warm near-black; one gold
   accent in both. Vocs maps `background` to the content panel and
   `backgroundDark` to the sidebar gutter, so ground = backgroundDark and
   the raised content panel = background (viem.sh shell). */
const light = {
	ground: "#f0ebdd",
	panel: "#f9f6ee",
	raise: "#fffdf8",
	ink: "#1c1a16",
};
const dark = {
	ground: "#111010",
	panel: "#171513",
	raise: "#1f1c19",
	ink: "#f2ede5",
};

export default defineConfig({
	title: "stacks",
	description: "Typed Stacks client for TypeScript. By secondlayer.",
	aiCta: false,
	vite: {
		/* Vocs 1.4.1 ships picomatch in the client bundle and it reads
		   `process.platform` at module init, which throws in the browser
		   and aborts hydration (no outline, search, tabs, copy buttons).
		   Static replacement keeps the module from touching `process`. */
		define: {
			"process.platform": JSON.stringify("browser"),
			"process.version": JSON.stringify(""),
			"process.env": "{}",
		},
	},
	font: {
		default: { google: "Public Sans" },
		mono: { google: "Fira Code" },
	},
	head: (
		<link
			href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500&display=swap"
			rel="stylesheet"
		/>
	),
	socials: [
		{
			icon: "github",
			link: "https://github.com/ryanwaits/secondlayer/tree/main/packages/stacks",
		},
	],
	theme: {
		variables: {
			color: {
				background: { light: light.panel, dark: dark.panel },
				background2: { light: light.raise, dark: dark.raise },
				background3: { light: light.raise, dark: dark.raise },
				background4: { light: "#ece6d6", dark: "#262320" },
				background5: { light: "#e4ddcb", dark: "#2e2a26" },
				backgroundDark: { light: light.ground, dark: dark.ground },
				backgroundDarkTint: { light: "#e8e2d2", dark: "#1c1a17" },
				backgroundAccent: { light: "#e3b117", dark: "#f0c430" },
				backgroundAccentHover: { light: "#d4a412", dark: "#f6d15a" },
				backgroundAccentText: { light: light.ink, dark: light.ink },
				border: {
					light: "rgba(28, 26, 22, 0.12)",
					dark: "rgba(242, 237, 229, 0.12)",
				},
				border2: {
					light: "rgba(28, 26, 22, 0.22)",
					dark: "rgba(242, 237, 229, 0.22)",
				},
				borderAccent: { light: "#e3b117", dark: "#f0c430" },
				heading: { light: light.ink, dark: dark.ink },
				title: { light: light.ink, dark: dark.ink },
				text: {
					light: "rgba(28, 26, 22, 0.82)",
					dark: "rgba(242, 237, 229, 0.82)",
				},
				text2: {
					light: "rgba(28, 26, 22, 0.6)",
					dark: "rgba(242, 237, 229, 0.6)",
				},
				text3: {
					light: "rgba(28, 26, 22, 0.45)",
					dark: "rgba(242, 237, 229, 0.45)",
				},
				text4: {
					light: "rgba(28, 26, 22, 0.3)",
					dark: "rgba(242, 237, 229, 0.3)",
				},
				textHover: { light: light.ink, dark: dark.ink },
				textAccent: { light: "#b8890a", dark: "#f0c430" },
				textAccentHover: { light: "#9a7208", dark: "#f6d15a" },
				shadow: { light: "rgba(28, 26, 22, 0.06)", dark: "rgba(0, 0, 0, 0.4)" },
				shadow2: {
					light: "rgba(28, 26, 22, 0.04)",
					dark: "rgba(0, 0, 0, 0.3)",
				},
			},
			fontWeight: { regular: "400", medium: "500", semibold: "500" },
			sidebar: { width: "280px" },
		},
	},
	markdown: {
		code: {
			themes: { light: stacksGold, dark: stacksGoldDark },
		},
	},
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
				{ text: "transactions", link: "/reference/transactions" },
				{ text: "utils", link: "/reference/utils" },
			],
		},
	],
	topNav: [
		{
			text: "Docs",
			link: "/getting-started",
			match: (path) =>
				path.startsWith("/getting-started") || path.startsWith("/guide"),
		},
		{ text: "Reference", link: "/reference/accounts", match: "/reference" },
		{
			text: "GitHub",
			link: "https://github.com/ryanwaits/secondlayer/tree/main/packages/stacks",
		},
	],
});
