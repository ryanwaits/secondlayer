import { PLATFORM_API_URL } from "@/lib/api";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ExploreDetail } from "../types";
import { FEATURED } from "../types";
import { DetailBody } from "./detail-body";

export const revalidate = 30;

async function fetchDetail(name: string): Promise<ExploreDetail | null> {
	try {
		const res = await fetch(`${PLATFORM_API_URL}/v1/subgraphs/${name}`, {
			next: { revalidate: 30 },
		});
		if (!res.ok) return null;
		return (await res.json()) as ExploreDetail;
	} catch {
		return null;
	}
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ name: string }>;
}): Promise<Metadata> {
	const { name } = await params;
	const title = `${name} — Explore Subgraphs | secondlayer`;
	const description = `Live public subgraph "${name}" on Secondlayer — query it at /v1/subgraphs/${name}, no key needed.`;
	// og:image and twitter:image come from the opengraph-image.tsx /
	// twitter-image.tsx file conventions in this segment.
	return {
		title,
		description,
		openGraph: {
			title,
			description,
			url: `/subgraphs/explore/${name}`,
			siteName: "secondlayer",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function ExploreDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	// The /v1 resolver 404s private subgraphs to anon — public-only by design.
	const detail = await fetchDetail(name);
	if (!detail || detail.visibility !== "public") notFound();

	return (
		<>
			<nav
				className="explore-crumb"
				aria-label="Breadcrumb"
				style={{
					maxWidth: 1180,
					margin: "3rem auto 1rem",
					padding: "0 1.5rem",
				}}
			>
				<Link href="/subgraphs">Subgraphs</Link>
				<span>/</span>
				<Link href="/subgraphs/explore">Explore</Link>
				<span>/</span>
				{detail.name}
			</nav>
			<DetailBody
				detail={detail}
				apiUrl={PLATFORM_API_URL}
				featured={FEATURED.includes(detail.name)}
			/>
		</>
	);
}
