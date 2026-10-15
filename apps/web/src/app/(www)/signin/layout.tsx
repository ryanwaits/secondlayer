import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page is a client component, so its share card lives here.
export const metadata: Metadata = socialMeta({
	title: "Sign in · secondlayer",
	description: "Sign in with your email to get an API key.",
	image: "/og/home.png",
	path: "/signin",
});

export default function SignInLayout({ children }: { children: ReactNode }) {
	return children;
}
