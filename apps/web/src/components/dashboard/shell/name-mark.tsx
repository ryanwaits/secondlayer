import type { ReactNode } from "react";
import { type Tone, dotClass } from "./status-sentence";

/** A resource name with its state. Healthy shows the bare name (green means
 *  nothing). Failing wraps it in a light red, dashed box. Warning and idle keep
 *  their small dot before the name. */
export function NameMark({
	tone,
	children,
}: {
	tone: Tone;
	children: ReactNode;
}) {
	if (tone === "alarm") return <span className="name-flag">{children}</span>;
	if (tone === "ok") return <>{children}</>;
	return (
		<>
			<span className={dotClass(tone)} />
			{children}
		</>
	);
}
