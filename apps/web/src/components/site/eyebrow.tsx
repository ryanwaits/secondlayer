export function Eyebrow({ noun, verb }: { noun: string; verb?: string }) {
	return (
		<span className="eyebrow">
			{noun}
			{verb ? <span>· {verb}</span> : null}
		</span>
	);
}
