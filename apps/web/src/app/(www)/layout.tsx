import { SiteFooter } from "@/components/site-footer";
import type { ReactNode } from "react";

export default function WwwLayout({ children }: { children: ReactNode }) {
	return (
		<div className="www">
			{children}
			<SiteFooter />
		</div>
	);
}
