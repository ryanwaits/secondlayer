import type { ReactNode } from "react";

/** "Run it yourself" band: heading left, copy and reference links right. */
export function SelfHostSlot({
	title = "Run it yourself",
	children,
	refs,
}: {
	title?: string;
	children: ReactNode;
	refs?: ReactNode;
}) {
	return (
		<div className="band band-soft">
			<div className="shell selfhost">
				<div>
					<h2 style={{ fontSize: 28 }}>{title}</h2>
				</div>
				<div>
					<p>{children}</p>
					{refs ? <div className="refs">{refs}</div> : null}
				</div>
			</div>
		</div>
	);
}
