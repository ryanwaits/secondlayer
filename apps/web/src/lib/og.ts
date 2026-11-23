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
	title: string | { absolute: string };
	description: string;
	image: string;
	path: string;
};

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
