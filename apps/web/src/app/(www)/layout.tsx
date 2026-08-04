import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { fetchNavSubgraphs } from "@/lib/nav-live";
import { readStatusSnapshot } from "@/lib/status-snapshot";
import type { ReactNode } from "react";

export default async function WwwLayout({ children }: { children: ReactNode }) {
	// Both are best-effort: each resolves to a safe empty value on failure so a
	// slow or down platform API can never take the marketing shell with it.
	const [status, liveSubgraphs] = await Promise.all([
		readStatusSnapshot(),
		fetchNavSubgraphs(),
	]);
	return (
		<div className="www">
			<MarketingNav liveSubgraphs={liveSubgraphs} />
			{children}
			<SiteFooter status={status} />
		</div>
	);
}
