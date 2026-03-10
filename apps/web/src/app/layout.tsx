import type { Metadata } from "next";
import { Inter, Caveat } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-cursive",
});

export const metadata: Metadata = {
  title: "Second Layer",
  description: "Bitcoin infrastructure for developers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${caveat.variable}`}>
        {children}
      </body>
    </html>
  );
}
