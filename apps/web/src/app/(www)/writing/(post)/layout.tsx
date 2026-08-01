import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Post shell — every page.mdx under (post)/ renders inside the reading
 * register. The route group keeps the /writing index (a plain list page)
 * outside the article styles. Per-post metadata comes from postMeta();
 * this fallback only covers a post that forgets to export it.
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
			<article className="writing-article">{children}</article>
		</main>
	);
}
