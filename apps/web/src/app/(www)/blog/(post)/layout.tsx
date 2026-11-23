import { PostRail } from "@/components/writing/post-rail";
import { ogImage } from "@/lib/og";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	openGraph: {
		images: [{ url: ogImage("/og/writing.png"), width: 1200, height: 630 }],
	},
	twitter: { images: [ogImage("/og/writing.png")] },
};

export default function WritingPostLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<main className="writing-shell">
			<div className="writing-grid">
				<article className="writing-article" id="writing-article">
					{children}
				</article>
				<PostRail />
			</div>
		</main>
	);
}
