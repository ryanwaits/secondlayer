import { AuthBar } from "@/components/auth-bar";
import { LazyCommandPalette } from "@/components/command-palette/lazy";
import { FastAnchorScroll } from "@/components/fast-anchor-scroll";
import { JsonLd } from "@/components/json-ld";
import { AuthProvider } from "@/lib/auth";
import { GITHUB_URL } from "@/lib/site";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-sans",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
});

export const metadata: Metadata = {
	// Without this, per-page `openGraph.images` like "/og/home.png" resolve
	// relative to the request URL, which breaks Twitter/Slack/iMessage card
	// previews on shared links.
	metadataBase: new URL("https://www.secondlayer.tools"),
	title: {
		default: "secondlayer · Stacks indexer: decoded data, webhooks, proofs",
		template: "%s · secondlayer",
	},
	description: "Instant data for apps on Bitcoin. Proof included.",
	appleWebApp: {
		capable: true,
		title: "secondlayer",
		statusBarStyle: "default",
	},
	openGraph: {
		title: "secondlayer",
		description: "Instant data for apps on Bitcoin. Proof included.",
		siteName: "secondlayer",
		type: "website",
		images: [
			{ url: "/og/home.png", width: 1200, height: 630, alt: "secondlayer" },
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "secondlayer",
		description: "Instant data for apps on Bitcoin. Proof included.",
		images: ["/og/home.png"],
	},
};

const SITE_URL = "https://www.secondlayer.tools";

const ORGANIZATION = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "secondlayer",
	url: SITE_URL,
	logo: `${SITE_URL}/logo-light.svg`,
	description:
		"secondlayer: a Stacks indexer. Decoded Stacks and Bitcoin Runes data from genesis, hosted webhooks, and tools to index your own app (Index API, Streams, Subgraphs, Webhooks), checkable against Bitcoin. Hosted or self-hosted.",
	sameAs: [GITHUB_URL, "https://www.npmjs.com/org/secondlayer"],
};

const WEBSITE = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "secondlayer",
	url: SITE_URL,
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<head>
				<JsonLd data={ORGANIZATION} />
				<JsonLd data={WEBSITE} />
			</head>
			<body
				className={`${geist.className} ${geist.variable} ${geistMono.variable}`}
			>
				<AuthProvider>
					{children}
					<AuthBar />
					<LazyCommandPalette />
					<FastAnchorScroll />
				</AuthProvider>
			</body>
		</html>
	);
}
