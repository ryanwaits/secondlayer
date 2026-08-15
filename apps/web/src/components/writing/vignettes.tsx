import { Timeline } from "@/components/figures";
import { MissingPanel } from "./missing-panel";

/**
 * Slugs that have a vignette below. The feature layout needs to know BEFORE
 * render whether a figure column exists — a `<PostVignette />` element is
 * truthy even when the component returns null, so testing the element drops
 * an empty box into the page instead of collapsing the column.
 */
const WITH_VIGNETTE = new Set([
	"checkpoint-receipt-not-bookmark",
	"not-in-anyones-api",
]);

export function hasVignette(slug: string): boolean {
	return WITH_VIGNETTE.has(slug);
}

/**
 * Feature art for the /writing front page. Two kinds live here:
 *
 * - A **hero** built for the slot: its own artwork, no caption, not a figure
 *   from the post (see `missing-panel.tsx`). This is the default for new posts.
 * - A **signature figure** lifted from the post and rendered small, captioned
 *   "Fig. N from the post". Older pattern; fine when the post's best figure
 *   genuinely is its cover.
 *
 * Add a case per post, and add its slug to WITH_VIGNETTE above.
 */
export function PostVignette({ slug }: { slug: string }) {
	switch (slug) {
		case "checkpoint-receipt-not-bookmark":
			return (
				<div className="writing-vignette">
					<Timeline
						ariaLabel="The post's timeline figure: delivery parked at 8,637,064 while scanned and tip coincide at 8,676,502."
						span={{ from: 16, to: 91, label: "verified empty: 39,438 blocks" }}
						events={[
							{
								pos: 16,
								label: "last_delivered",
								value: "8,637,064",
								role: "a",
								major: true,
							},
							{
								pos: 91,
								label: "scanned · tip",
								value: "8,676,502",
								role: "b",
								major: true,
							},
						]}
					/>
					<div className="writing-vignette-cap">Fig. 1 from the post</div>
				</div>
			);
		case "not-in-anyones-api":
			// Hero, not a figure: no caption, nothing lifted from the post.
			return <MissingPanel />;
		default:
			return null;
	}
}
