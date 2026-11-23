import type { Story, StoryVariant } from "./stories";

export const MODES = [
	{ mode: "light", label: "Light" },
	{ mode: "dark", label: "Dark" },
] as const;

export type Mode = (typeof MODES)[number]["mode"];

export function LabFrame({
	story,
	variant,
	mode,
	caption,
}: {
	story: Story;
	variant: StoryVariant;
	mode: Mode;
	caption?: string;
}) {
	const node = variant.render(`${variant.id}-${mode}`);
	return (
		<section className="lab-fr" data-mode={mode}>
			{caption && <span className="lab-fr-cap">{caption}</span>}
			<div className="site lab-in">
				{story.width ? <div className="lab-w">{node}</div> : node}
			</div>
		</section>
	);
}
