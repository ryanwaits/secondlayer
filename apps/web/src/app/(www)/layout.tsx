import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { readGithubStars } from "@/lib/github-stars";
import type { ReactNode } from "react";

export default async function WwwLayout({ children }: { children: ReactNode }) {
	const stars = await readGithubStars();
	return (
		<div className="www">
			<MarketingNav stars={stars} />
			{children}
			<SiteFooter />
		</div>
	);
}
