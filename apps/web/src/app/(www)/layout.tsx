import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { readStatusSnapshot } from "@/lib/status-snapshot";
import type { ReactNode } from "react";

/** Star count for the nav's GitHub pill; absent on API failure. */
async function readGithubStars(): Promise<number | null> {
	try {
		const res = await fetch(
			"https://api.github.com/repos/ryanwaits/secondlayer",
			{
				next: { revalidate: 3600 },
			},
		);
		if (!res.ok) return null;
		const repo = (await res.json()) as { stargazers_count?: number };
		return typeof repo.stargazers_count === "number"
			? repo.stargazers_count
			: null;
	} catch {
		return null;
	}
}

export default async function WwwLayout({ children }: { children: ReactNode }) {
	const [status, stars] = await Promise.all([
		readStatusSnapshot(),
		readGithubStars(),
	]);
	return (
		<div className="www">
			<MarketingNav stars={stars} />
			{children}
			<SiteFooter status={status} />
		</div>
	);
}
