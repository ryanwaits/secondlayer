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
						<a>{action.label}</a>
					)}
				</div>
			)}
		</div>
	);
}
