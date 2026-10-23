import type { ReactNode } from "react";

/**
 * A resource name that opens its detail drawer. Hover or keyboard focus shows
 * the tip ("Click for details"); touch screens get no tip.
 */
export function NameTip({
	tip,
	onOpen,
	children,
}: {
	tip: string;
	onOpen: () => void;
	children: ReactNode;
}) {
	return (
		<button type="button" className="name-tip" data-tip={tip} onClick={onOpen}>
			{children}
		</button>
	);
}
