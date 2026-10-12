/** Mono tag + the product's one verb: "Index · decodes". */
export function Eyebrow({ noun, verb }: { noun: string; verb?: string }) {
	return (
		<span className="eyebrow">
			{noun}
			{verb ? <span>· {verb}</span> : null}
		</span>
	);
}
