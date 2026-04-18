import { AuthBar } from "@/components/auth-bar";
import { LazyCommandPalette } from "@/components/command-palette/lazy";
import { AuthProvider } from "@/lib/auth";
import { PreferencesProvider } from "@/lib/preferences";
import { QueryProvider } from "@/lib/queries/provider";
import type { Metadata, Viewport } from "next";
import { Caveat, Fira_Code, Public_Sans, Sora } from "next/font/google";
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
	title: "secondlayer",
	description: "Developer tools for Stacks",
	openGraph: {
		title: "secondlayer",
		description: "Developer tools for Stacks",
		images: [{ url: "/og.png", width: 1200, height: 630 }],
	},
	twitter: {
		card: "summary_large_image",
		title: "secondlayer",
		description: "Developer tools for Stacks",
		images: ["/og.png"],
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
			</body>
		</html>
	);
}
