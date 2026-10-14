import { CodeClient } from "@/components/code/code-client";
import { notFound } from "next/navigation";
import { LabFrame, MODES } from "../../../../frame";
import { STORIES, getStory } from "../../../../stories";

type Params = { id: string; variant: string; mode: string };

export function generateStaticParams(): Params[] {
	return STORIES.flatMap((story) =>
		story.variants.flatMap((variant) =>
			MODES.map(({ mode }) => ({ id: story.id, variant: variant.id, mode })),
		),
	);
}

/**
 * One variant in one theme, with no lab chrome. The story page embeds it in an
 * iframe for its 400 view, so viewport media queries fire at the real width.
 */
export default async function FramePage({
	params,
}: { params: Promise<Params> }) {
	const { id, variant: variantId, mode } = await params;
	const story = getStory(id);
	const variant = story?.variants.find((v) => v.id === variantId);
	const known = MODES.find((m) => m.mode === mode);
	if (!story || !variant || !known) notFound();
	return (
		<div className="lab lab-solo">
			<LabFrame story={story} variant={variant} mode={known.mode} />
			<CodeClient />
		</div>
	);
}
