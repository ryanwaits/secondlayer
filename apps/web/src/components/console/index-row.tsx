import Link from "next/link";
import type { ReactNode } from "react";

interface IndexRowProps {
	href: string;
	name: string;
	badge?: ReactNode;
	description?: string;
	stats?: { label: string; value: string }[];
}

export function IndexRow({
	href,
	name,
	badge,
	description,
	stats,
}: IndexRowProps) {
	return (
		<Link href={href} className="index-row">
			<span className="index-row-name">{name}</span>
			{badge}
			{description && <span className="index-row-desc">{description}</span>}
			{stats && (
				<div className="index-row-stats">
					{stats.map((s) => (
						<span key={s.label} className="index-row-stat">
							{s.value}
						</span>
					))}
				</div>
			)}
		</Link>
	);
}
