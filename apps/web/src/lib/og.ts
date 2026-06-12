import type { Metadata } from "next";

type SocialMetaInput = {
	title: string;
	description: string;
	/** Path to the 1200x630 share card under /public, e.g. "/og/streams.png" */
	image: string;
	/** Canonical route path, e.g. "/streams" */
	path: string;
};

/**
 * Title, description, and the full Open Graph + Twitter card set for a
 * marketing route. Relative URLs resolve against metadataBase in the root
 * layout.
 */
export function socialMeta({
	title,
	description,
	image,
	path,
}: SocialMetaInput): Metadata {
	return {
		title,
		description,
		openGraph: {
			title,
			description,
			url: path,
			siteName: "secondlayer",
			type: "website",
			images: [{ url: image, width: 1200, height: 630, alt: title }],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: [image],
		},
	};
}
