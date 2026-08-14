import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { readStatusSnapshot } from "@/lib/status-snapshot";
import type { ReactNode } from "react";

export default async function WwwLayout({ children }: { children: ReactNode }) {
	const status = await readStatusSnapshot();
	return (
		<div className="www">
			<MarketingNav />
			{children}
			<SiteFooter status={status} />
		</div>
	);
}
