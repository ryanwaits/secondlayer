const LABEL = {
	live: "live",
	rolling: "rolling out",
	soon: "Coming soon",
} as const;

const CLASS = { live: "live", rolling: "roll", soon: "soon" } as const;

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
