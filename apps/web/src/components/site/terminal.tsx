import type { ReactNode } from "react";

/**
 * Dark terminal window. Children are either a `<CodeBlock code lang />` for
 * code, or `<pre>` transcript lines using the `t-m` / `t-a` / `t-ok` /
 * `t-hit` span classes for shell sessions.
 */
export function Terminal({
	title,
	meta,
	children,
}: {
	title: string;
	meta?: string;
	children: ReactNode;
}) {
	return (
		<div className="art term">
			<div className="term-bar">
				<i />
				<i />
				<i />
				<span>{title}</span>
				{meta ? <span className="sp">{meta}</span> : null}
			</div>
			{children}
		</div>
	);
}
