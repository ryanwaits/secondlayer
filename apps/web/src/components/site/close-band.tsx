import type { ReactNode } from "react";

export function CloseBand({
	title,
	cta,
}: {
	title: ReactNode;
	cta: ReactNode;
}) {
	return (
		<div className="band close">
			<div className="shell">
				<div className="close-in">
					<h2>{title}</h2>
					<div className="btns">{cta}</div>
				</div>
			</div>
		</div>
	);
}
