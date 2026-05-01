import Link from "next/link";

export function EmptyState({
	message,
	action,
}: {
	message: string;
	action?: { label: string; href?: string };
}) {
	return (
		<div className="dash-empty">
			<p>{message}</p>
			{action && (
				<div className="dash-empty-action">
					{action.href ? (
						<Link href={action.href}>{action.label}</Link>
					) : (
						<span>{action.label}</span>
					)}
				</div>
			)}
		</div>
	);
}
