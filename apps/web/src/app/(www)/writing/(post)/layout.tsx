import { PostRail } from "@/components/writing/post-rail";
import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Post shell: a sticky rail on the site's left edge and one reading column,
 * on the same 1072px grid as every other page. Every page.mdx under (post)/
 * renders in the column. Per-post metadata comes from postMeta(); this
 * fallback only covers a post that forgets to export it.
 */
export const metadata: Metadata = {
	openGraph: { images: [{ url: "/og/writing.png", width: 1200, height: 630 }] },
	twitter: { images: ["/og/writing.png"] },
};

export default function WritingPostLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<main className="writing-shell">
			<div className="writing-grid">
				<PostRail />
				<article className="writing-article" id="writing-article">
					{children}
				</article>
			</div>
		</main>
	);
}
