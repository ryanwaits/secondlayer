import { AuthBar } from "@/components/auth-bar";
import { LazyCommandPalette } from "@/components/command-palette/lazy";
import { AuthProvider } from "@/lib/auth";
import { PreferencesProvider } from "@/lib/preferences";
import { QueryProvider } from "@/lib/queries/provider";
import type { Metadata, Viewport } from "next";
import { Caveat, Fira_Code, Public_Sans, Sora } from "next/font/google";
import Script from "next/script";
import "./globals.css";

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};

const sora = Sora({
	subsets: ["latin"],
	variable: "--font-heading",
});

const publicSans = Public_Sans({
	subsets: ["latin"],
	variable: "--font-sans",
});

const firaCode = Fira_Code({
	subsets: ["latin"],
	variable: "--font-mono",
});

const caveat = Caveat({
	subsets: ["latin"],
	variable: "--font-cursive",
});

export const metadata: Metadata = {
	// Without this, per-page `openGraph.images` like "/og/home.png" resolve
	// relative to the request URL, which breaks Twitter/Slack/iMessage card
	// previews on shared links.
	metadataBase: new URL("https://www.secondlayer.tools"),
	title: "secondlayer",
	description: "The hosted indexer for Stacks",
	openGraph: {
		title: "secondlayer",
		description: "The hosted indexer for Stacks",
		siteName: "secondlayer",
		type: "website",
		images: [
			{ url: "/og/home.png", width: 1200, height: 630, alt: "secondlayer" },
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "secondlayer",
		description: "The hosted indexer for Stacks",
		images: ["/og/home.png"],
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body
				className={`${publicSans.className} ${sora.variable} ${publicSans.variable} ${firaCode.variable} ${caveat.variable}`}
			>
				<QueryProvider>
					<AuthProvider>
						<PreferencesProvider>
							{children}
							<AuthBar />
							<LazyCommandPalette />
						</PreferencesProvider>
					</AuthProvider>
				</QueryProvider>
				{/* Self-hosted Umami web analytics (umami.secondlayer.tools). */}
				<Script
					src="https://umami.secondlayer.tools/script.js"
					data-website-id="c97d8770-49d6-4a55-adae-07310f3d8d5e"
					strategy="afterInteractive"
				/>
			</body>
		</html>
	);
}
