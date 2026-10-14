import { getPost, longDate } from "@/lib/writing";
import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * Post masthead: "Blog · 02", the title, the dek. The rail beside the column
 * carries the date, length, sections and figures; below 760px the rail hides
 * and the one-line meta under the title carries the way back and the date.
 * Title lives ONLY here — post MDX bodies start at h2 so the docs MdxH1
 * mapping is never hit.
 *
 * Also the draft gate: drafts 404 in production (and stay out of the
 * build output for static pages) while remaining reachable in dev.
 */
export function PostHeader({ slug }: { slug: string }) {
	const post = getPost(slug);
	if (!post) notFound();
	if (post.status === "draft" && process.env.NODE_ENV === "production") {
		notFound();
	}

	return (
		<header className="writing-header">
			<span className="writing-eyebrow">
				Blog <span>· {String(post.number).padStart(2, "0")}</span>
			</span>
			<h1 className="writing-title">{post.title}</h1>
			<p className="writing-dek">{post.dek}</p>
			<p className="writing-meta">
				<Link href="/writing">← Blog</Link>
				<span>{longDate(post.date)}</span>
				<span>{post.readingTime}</span>
			</p>
		</header>
	);
}
