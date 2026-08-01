import { getPublishedPosts } from "@/lib/writing";

export const dynamic = "force-static";

const BASE = "https://www.secondlayer.tools";

function esc(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** RSS 2.0 feed of published writings. Registry-driven; no MDX rendering. */
export function GET(): Response {
	const items = getPublishedPosts()
		.map((post) => {
			const url = `${BASE}/writing/${post.slug}`;
			const pubDate = new Date(`${post.date}T00:00:00Z`).toUTCString();
			return `    <item>
      <title>${esc(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${esc(post.dek)}</description>
    </item>`;
		})
		.join("\n");

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>secondlayer writings</title>
    <link>${BASE}/writing</link>
    <atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Long-form, mechanism-first posts on indexers, consumers, and the systems underneath.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;

	return new Response(xml, {
		headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
	});
}
