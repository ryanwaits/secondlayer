import type { ReactNode } from "react";

interface DetailSectionProps {
	title: string;
	actions?: ReactNode;
	children: ReactNode;
}

export function DetailSection({
	title,
	actions,
	children,
}: DetailSectionProps) {
	return (
		<div className="sg-detail-section">
			<div className="sg-detail-header">
				<span className="sg-detail-title">{title}</span>
				{actions && <div className="sg-detail-actions">{actions}</div>}
			</div>
			{children}
		</div>
	);
}
