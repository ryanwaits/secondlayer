import type { Metadata } from "next";
import { Fira_Code, Public_Sans, Sora } from "next/font/google";
import "@/styles/tokens.css";
import "@/styles/console.css";
import "@/styles/gate.css";

const sora = Sora({
	subsets: ["latin"],
	weight: ["400", "500"],
	variable: "--font-sora",
});
const publicSans = Public_Sans({
	subsets: ["latin"],
	weight: ["400", "500"],
	variable: "--font-public-sans",
});
const firaCode = Fira_Code({
	subsets: ["latin"],
	weight: ["400", "500"],
	variable: "--font-fira-code",
});

export const metadata: Metadata = {
	title: "Secondlayer console",
	description: "Observability for your self-hosted Secondlayer instance.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="en"
			className={`${sora.variable} ${publicSans.variable} ${firaCode.variable}`}
			suppressHydrationWarning
		>
			<body>{children}</body>
		</html>
	);
}
