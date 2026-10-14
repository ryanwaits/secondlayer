import { AuthBar } from "@/components/auth-bar";
import { LazyCommandPalette } from "@/components/command-palette/lazy";
import { FastAnchorScroll } from "@/components/fast-anchor-scroll";
import { AuthProvider } from "@/lib/auth";
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
	title: "secondlayer",
	description: "Instant data for apps on Bitcoin. Proof included.",
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

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
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
