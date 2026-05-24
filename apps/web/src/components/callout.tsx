/**
 * Lightweight accented callout for tips, notes, and link-outs.
 */
export function Callout({
	children,
	label,
}: {
	children: React.ReactNode;
	label?: string;
}) {
	return (
		<aside className="callout">
			{label ? <span className="callout-label">{label}</span> : null}
			<div className="callout-body">{children}</div>
		</aside>
	);
}
