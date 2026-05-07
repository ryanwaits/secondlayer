import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWritingBySlug, type WritingPost, writings } from "../posts";

type RouteParams = { slug: string };

export function generateStaticParams(): RouteParams[] {
	return writings.map((post) => ({ slug: post.slug }));
}

export function generateMetadata({
	params,
}: {
	params: RouteParams;
}): Metadata {
	const post = getWritingBySlug(params.slug);
	if (!post) return { title: "Writings | secondlayer" };
	return {
		title: `${post.title} | secondlayer`,
		description: post.description,
		...(post.metadata ?? {}),
	};
}

const POST_TOC: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "What's coming", href: "#whats-coming" },
];

export default function WritingsPostPage({ params }: { params: RouteParams }) {
	const post = getWritingBySlug(params.slug);
	if (!post) notFound();

	return (
		<div className="article-layout">
			<Sidebar
				title={post.title}
				toc={POST_TOC}
				backHref="/writings"
				backLabel="Writings"
			/>
			<WritingsPostContent post={post} />
		</div>
	);
}

export function WritingsPostContent({ post }: { post: WritingPost }) {
	const Body = post.Component;
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">{post.title}</h1>
				<div
					style={{
						marginTop: "var(--spacing-xs)",
						color: "var(--text-muted)",
						fontSize: 13,
					}}
				>
					{post.date}
				</div>
			</header>
			<Body />
		</main>
	);
}

