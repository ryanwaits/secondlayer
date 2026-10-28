import type { Metadata } from "next";

type SocialMetaInput = {
	/**
	 * Page title; the nearest layout's title template adds the brand. Pass
	 * `{ absolute }` for a title that must render exactly as written.
	 */
	title: string | { absolute: string };
	description: string;
	/** Path to the 1200x630 share card under /public, e.g. "/og/archive.png" */
	image: string;
	/** Canonical route path, e.g. "/p/archive" */
	path: string;
};

/**
 * Title, description, canonical URL, and the full Open Graph + Twitter card
 * set for a marketing route. Relative URLs resolve against metadataBase in the
 * root layout.
 */
export function socialMeta({
	title,
	description,
	image,
	path,
}: SocialMetaInput): Metadata {
	const cardTitle = typeof title === "string" ? title : title.absolute;
	return {
		title,
		description,
		alternates: { canonical: path },
		openGraph: {
			title: cardTitle,
			description,
			url: path,
			siteName: "secondlayer",
			type: "website",
			images: [{ url: image, width: 1200, height: 630, alt: cardTitle }],
		},
		twitter: {
			card: "summary_large_image",
			title: cardTitle,
			description,
			images: [image],
		},
	};
}
