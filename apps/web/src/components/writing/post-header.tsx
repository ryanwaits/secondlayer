import { getPost } from "@/lib/writing";
import { notFound } from "next/navigation";

/**
 * Post masthead: eyebrow (Writings · NN + reading time + tags), Sora title,
 * dek, and the hairline meta row. The title lives ONLY here — post MDX
 * bodies start at h2 so the docs MdxH1 mapping is never hit.
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

	const number = String(post.number).padStart(2, "0");
	const date = new Date(`${post.date}T00:00:00Z`).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});

	return (
		<header>
			<div className="writing-eyebrow">
				<span>Writings · {number}</span>
				<span className="dim">{post.readingTime}</span>
				<span className="dim">{post.tags.join(" · ")}</span>
			</div>
			<h1 className="writing-title">{post.title}</h1>
			<p className="writing-dek">{post.dek}</p>
			<div className="writing-meta">
				<span>secondlayer</span>
				<span>·</span>
				<span>{date}</span>
			</div>
		</header>
	);
}
