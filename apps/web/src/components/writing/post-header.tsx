import { getPost, longDate } from "@/lib/writing";
import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * Post masthead: a "Blog / 02" breadcrumb, the title, the dek. The rail beside the column
 * carries the date, length, sections and figures; below 760px the rail hides
 * and the one-line meta under the title carries the date and length.
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
			<nav className="writing-eyebrow" aria-label="Breadcrumb">
				<Link href="/writing">Blog</Link>
				<span aria-hidden="true">/</span>
				<span aria-current="page">{String(post.number).padStart(2, "0")}</span>
			</nav>
			<h1 className="writing-title">{post.title}</h1>
			<p className="writing-dek">{post.dek}</p>
			<p className="writing-meta">
				<span>{longDate(post.date)}</span>
				<span>{post.readingTime}</span>
			</p>
		</header>
	);
}
