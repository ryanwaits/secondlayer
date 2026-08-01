import { getPost } from "@/lib/writing";
import { notFound } from "next/navigation";

/**
 * Post masthead + the right meta rail. On viewports ≥1160px the number,
 * date, reading time, figure index, and tags live in an absolutely
 * positioned rail beside the column (and margin sidenotes float LEFT to
 * stay out of its way); below that the same facts render as the inline
 * eyebrow + meta row, and the rail is hidden. Title lives ONLY here —
 * post MDX bodies start at h2 so the docs MdxH1 mapping is never hit.
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
		<header className="writing-header">
			<aside className="writing-rail" aria-label="Post details">
				<span className="k">Writings</span>
				<span className="no">№ {number}</span>
				<span>{date}</span>
				<span>{post.readingTime} read</span>
				{post.figures && post.figures.length > 0 && (
					<>
						<span className="k">Figures</span>
						{post.figures.map((title, i) => (
							<a key={title} className="fig-ln" href={`#fig-${i + 1}`}>
								<b>{i + 1}</b> · {title}
							</a>
						))}
					</>
				)}
				<span className="k">Tags</span>
				<span>{post.tags.join(" · ")}</span>
			</aside>
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
