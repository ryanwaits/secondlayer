import ogCards from "@/generated/og-cards.json";
import type { Metadata } from "next";

const CARD_HASHES: Record<string, string> = ogCards;

/**
 * A card's URL with a hash of its bytes, so a replaced card gets a new address
 * and link-preview caches keyed on the URL fetch it. `bun run og` writes the
 * hashes.
 */
export function ogImage(path: string): string {
	const hash = CARD_HASHES[path.replace(/^\/og\//, "")];
	if (!hash) throw new Error(`No share card for ${path}: run bun run og`);
	return `${path}?v=${hash}`;
}

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
	const card = ogImage(image);
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
			images: [{ url: card, width: 1200, height: 630, alt: cardTitle }],
		},
		twitter: {
			card: "summary_large_image",
			title: cardTitle,
			description,
			images: [card],
		},
	};
}
