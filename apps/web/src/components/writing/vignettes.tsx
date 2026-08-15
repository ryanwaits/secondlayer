import { MissingPanel } from "./missing-panel";

/**
 * Slugs that have a vignette below. The feature layout needs to know BEFORE
 * render whether a figure column exists — a `<PostVignette />` element is
 * truthy even when the component returns null, so testing the element drops
 * an empty box into the page instead of collapsing the column.
 */
const WITH_VIGNETTE = new Set(["not-in-anyones-api"]);

export function hasVignette(slug: string): boolean {
	return WITH_VIGNETTE.has(slug);
}

/**
 * Feature art for the /writing front page.
 *
 * Only the NEWEST post renders one: the index features the top post and lists
 * the rest as text rows. Building art for an older post is dead code, so add a
 * case when a post becomes the feature, not when it is written.
 *
 * The art is its own artifact: no caption, nothing lifted from the post (see
 * `missing-panel.tsx`). The earlier pattern shrank a post's Fig. 1 into the
 * slot and captioned it "Fig. N from the post"; that is retired. Recipe and
 * traps: the `writing` skill's references/hero-art.md.
 *
 * Add a case per post, and add its slug to WITH_VIGNETTE above.
 */
export function PostVignette({ slug }: { slug: string }) {
	switch (slug) {
		case "not-in-anyones-api":
			// Hero, not a figure: no caption, nothing lifted from the post.
			return <MissingPanel />;
		default:
			return null;
	}
}
