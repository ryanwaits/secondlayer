import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import type { ReactNode } from "react";
import "./site.css";

export default function WwwLayout({ children }: { children: ReactNode }) {
	return (
		<div className="www">
			<MarketingNav />
			{children}
			<SiteFooter />
		</div>
	);
}
