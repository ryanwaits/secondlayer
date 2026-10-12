const LABEL = {
	live: "live",
	rolling: "rolling out",
	soon: "Coming soon",
} as const;

const CLASS = { live: "live", rolling: "roll", soon: "soon" } as const;

/** live = ok fill. rolling/soon = hollow neutral ring, never yellow. */
export function StatusDot({
	state,
	label,
}: {
	state: keyof typeof LABEL;
	label?: string;
}) {
	return (
		<span className={`status ${CLASS[state]}`}>
			<i />
			{label ?? LABEL[state]}
		</span>
	);
}
