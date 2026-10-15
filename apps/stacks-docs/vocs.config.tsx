import { defineConfig } from "vocs";
import pkg from "../../packages/stacks/package.json";
import { secondlayer, secondlayerDark } from "../web/src/lib/syntax-theme";
import { alpha, brand } from "./docs/brand";
import { getStars } from "./docs/stats";

const stars = await getStars();

/* Brand roles (docs/brand.ts, mirrored from DESIGN.md). Vocs maps
   `background` to the content panel and `backgroundDark` to the page ground
   and sidebar. Ground = soft in light, paper in dark; panel = paper in
   light, soft in dark, so the panel is always the brighter neutral
   (founder decision 2026-10-14, no new hex). */
const L = brand.light;
const D = brand.dark;
const hover = (r: typeof L) => `color-mix(in srgb, ${r.pri} 86%, ${r.paper})`;

export default defineConfig({
	title: "stacks",
	description: "Typed Stacks client for TypeScript. By secondlayer.",
	aiCta: false,
	baseUrl: "https://stacks.secondlayer.tools",
	/* Favicon: the secondlayer mark in ink, one per scheme. OG card:
	   docs/public/og.png, rendered from docs/og-card.html at 1200×630
	   (agent-browser screenshot); re-render when the tagline changes. */
	iconUrl: { light: "/icon-light.svg", dark: "/icon-dark.svg" },
	/* Path-map form on purpose: Vocs 1.4.1's useOgImageUrl returns nothing
	   for a plain string. "/" matches every route. */
	ogImageUrl: { "/": "https://stacks.secondlayer.tools/og.png" },
	vite: {
		/* Vocs 1.4.1 ships picomatch in the client bundle and it reads
		   `process.platform` at module init, which throws in the browser
		   and aborts hydration (no outline, search, tabs, copy buttons).
		   Static replacement keeps the module from touching `process`. */
		define: {
			"process.platform": JSON.stringify("browser"),
			"process.version": JSON.stringify(""),
			"process.env": "{}",
			/* Landing badge row (docs/components/Badges.tsx). */
			__SL_STARS__: JSON.stringify(stars),
			__SL_LICENSE__: JSON.stringify(pkg.license),
		},
	},
	font: {
		default: { google: "Geist" },
		mono: { google: "Geist Mono" },
	},
	socials: [
		{
			icon: "github",
			link: "https://github.com/ryanwaits/secondlayer/tree/main/packages/stacks",
		},
	],
	theme: {
		variables: {
			color: {
				background: { light: L.paper, dark: D.soft },
				background2: { light: L.paper, dark: D.soft },
				background3: { light: L.paper, dark: D.soft },
				background4: { light: L.soft, dark: D.paper },
				background5: { light: L.line, dark: D.line },
				backgroundDark: { light: L.soft, dark: D.paper },
				backgroundDarkTint: { light: L.line, dark: D.soft },
				backgroundAccent: { light: L.pri, dark: D.pri },
				backgroundAccentHover: { light: hover(L), dark: hover(D) },
				backgroundAccentText: { light: L["on-pri"], dark: D["on-pri"] },
				border: { light: L.line, dark: D.line },
				border2: { light: alpha(L.ink, 0.2), dark: alpha(D.ink, 0.24) },
				borderAccent: { light: L.pri, dark: D.pri },
				heading: { light: L.ink, dark: D.ink },
				title: { light: L.ink, dark: D.ink },
				text: { light: alpha(L.ink, 0.74), dark: alpha(D.ink, 0.8) },
				text2: { light: L.sub, dark: D.sub },
				text3: { light: L.faint, dark: D.faint },
				text4: { light: alpha(L.ink, 0.28), dark: alpha(D.ink, 0.34) },
				textHover: { light: L.ink, dark: D.ink },
				textAccent: { light: L.pri, dark: D.pri },
				textAccentHover: { light: hover(L), dark: hover(D) },
				link: { light: L.pri, dark: D.pri },
				linkHover: { light: hover(L), dark: hover(D) },
				hr: { light: L.line, dark: D.line },
				tableBorder: { light: L.line, dark: D.line },
				codeBlockBackground: { light: L.paper, dark: D.soft },
				codeInlineBackground: { light: L.soft, dark: D.paper },
				codeInlineBorder: { light: L.line, dark: D.line },
				codeInlineText: { light: L.ink, dark: D.ink },
				lineNumber: { light: L.faint, dark: D.faint },
				shadow: { light: alpha(L.ink, 0.06), dark: "rgba(0, 0, 0, 0.4)" },
				shadow2: { light: alpha(L.ink, 0.04), dark: "rgba(0, 0, 0, 0.3)" },
			},
			fontWeight: { regular: "400", medium: "500", semibold: "500" },
			sidebar: { width: "280px" },
		},
	},
	markdown: {
		code: {
			/* The brand's own code theme, imported so the two never drift. */
			themes: { light: secondlayer, dark: secondlayerDark },
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
