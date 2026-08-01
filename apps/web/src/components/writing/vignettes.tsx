import { Timeline } from "@/components/figures";

/**
 * Signature-figure vignettes for the /writing front page: each post's most
 * characteristic figure, rendered small as the feature art. Real library
 * components with real data — the figures ARE the imagery. Add a case per
 * post; returning null drops the feature's figure column gracefully.
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
		default:
			return null;
	}
}
