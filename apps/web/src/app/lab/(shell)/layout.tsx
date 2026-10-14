import { CodeClient } from "@/components/code/code-client";
import type { ReactNode } from "react";
import { LabChrome } from "../story-controls";
import { NAV_ITEMS } from "../tree";

/** The lab's chrome: top bar and story tree around every story page. */
export default function LabShellLayout({ children }: { children: ReactNode }) {
	return (
		<div className="lab">
			<LabChrome items={NAV_ITEMS}>{children}</LabChrome>
			<CodeClient />
		</div>
	);
}
