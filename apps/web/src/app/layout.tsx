import type { Metadata } from "next";
import { Sora, Public_Sans, Fira_Code, Caveat } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { PreferencesProvider } from "@/lib/preferences";
import { AuthBar } from "@/components/auth-bar";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { QueryProvider } from "@/lib/queries/provider";
import "./globals.css";

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
  description: "Agent-native developer tools for Stacks",
  openGraph: {
    title: "secondlayer",
    description: "Agent-native developer tools for Stacks",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "secondlayer",
    description: "Agent-native developer tools for Stacks",
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
      <body className={`${publicSans.className} ${sora.variable} ${publicSans.variable} ${firaCode.variable} ${caveat.variable}`}>
        <QueryProvider>
          <AuthProvider>
            <PreferencesProvider>
              {children}
              <AuthBar />
              <CommandPalette />
            </PreferencesProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
