import { getAdjacentPosts } from "@/lib/writing";
import Link from "next/link";

/**
 * Continuum footer: the post ends by handing you the next one. Prev/next
 * come free from the registry order. The feed still exists at /feed.xml and
 * is advertised via <link rel="alternate"> — it just isn't sold in the body.
 */
export function PostFooter({ slug }: { slug: string }) {
	const { prev, next } = getAdjacentPosts(slug);

	return (
		<footer className="writing-end">
			<div className="writing-next">
				<div className="writing-next-cell">
					<span className="k">← Previous</span>
					{prev ? (
						<>
							<Link href={`/writing/${prev.slug}`} className="t">
								{prev.title}
							</Link>
							<span className="m">
								{prev.date} · {prev.readingTime}
							</span>
						</>
					) : (
						<>
							<span className="t none">—</span>
							<span className="m">this is the first post</span>
						</>
					)}
				</div>
				<div className="writing-next-cell">
					<span className="k">Next →</span>
					{next ? (
						<>
							<Link href={`/writing/${next.slug}`} className="t">
								{next.title}
							</Link>
							<span className="m">
								{next.date} · {next.readingTime}
							</span>
						</>
					) : (
						<>
							<span className="t none">—</span>
							<span className="m">you&rsquo;re caught up</span>
						</>
					)}
				</div>
			</div>
		</footer>
	);
}
