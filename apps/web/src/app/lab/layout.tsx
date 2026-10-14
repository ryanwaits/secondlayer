import { CodeClient } from "@/components/code/code-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { labEnabled } from "./enabled";
import "./lab.css";
import { LabChrome } from "./story-controls";
import { NAV_ITEMS } from "./tree";

export const metadata: Metadata = {
	title: "Lab · secondlayer",
	robots: { index: false, follow: false },
};

/**
 * Internal component lab. Its own shell, outside (www), so no marketing nav or
 * footer. `labEnabled()` is the whole gate: anything else is a 404.
 */
export default function LabLayout({ children }: { children: ReactNode }) {
	if (!labEnabled()) notFound();
	return (
		<div className="lab">
			<LabChrome items={NAV_ITEMS}>{children}</LabChrome>
			<CodeClient />
		</div>
	);
}
