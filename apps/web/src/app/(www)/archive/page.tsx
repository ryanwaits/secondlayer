import { CodeBlock } from "@/components/code-block";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import { ArchiveCredits } from "./archive-credits";

export const metadata: Metadata = socialMeta({
	title: "Archive · secondlayer",
	description:
		"Genesis to tip, signed and public to check. Verify is free. Restore and backfill off our R2 are metered.",
	image: "/og/archive.png",
	path: "/archive",
});

type UseCase = {
	title: string;
	badge: "free" | "metered";
	body: string;
	cmd: string;
};

const USE_CASES: UseCase[] = [
	{
		title: "Verify an instance",
		badge: "free",
		body: "Digest-check every range of your local data against the signed manifest. Runs read-only against your database; nothing is uploaded.",
		cmd: "secondlayer verify all \\\n  --against https://archive.secondlayer.tools/latest.json",
	},
	{
		title: "Bootstrap a fresh box",
		badge: "metered",
		body: "Stand up a new instance from the archive instead of replaying the chain — genesis to tip arrives as verified partitions.",
		cmd: "secondlayer bootstrap \\\n  --against https://archive.secondlayer.tools/latest.json",
	},
	{
		title: "Backfill history",
		badge: "metered",
		body: "Your node only reaches back so far. Bootstrap the range behind it from the archive, then follow the node forward for free.",
		cmd: "secondlayer bootstrap --to-block <n> \\\n  --against https://archive.secondlayer.tools/latest.json",
	},
	{
		title: "Repair gaps",
		badge: "metered",
		body: "When verify finds a broken or missing range, repair plans the fix as a dry run, then heals exactly those partitions with --apply.",
		cmd: "secondlayer repair --apply \\\n  --against https://archive.secondlayer.tools/latest.json",
	},
];

export default function ArchivePage() {
	return (
		<div className="home archive-page">
			<section className="home-hero archive-hero">
				<h1>
					The verified
					<br />
					<span className="home-h1-dim">Stacks archive.</span>
				</h1>
				<p className="home-sub">
					Signed, contiguous from genesis, and served in the open. Checking your
					node against it is free, forever.
				</p>
			</section>

			<section className="archive-body">
				<div className="archive-cases">
					{USE_CASES.map((u) => (
						<article className="archive-case" key={u.title}>
							<h2>
								{u.title}
								<span className="archive-badge" data-kind={u.badge}>
									{u.badge}
								</span>
							</h2>
							<p>{u.body}</p>
							<div className="archive-case-cmd">
								<CodeBlock code={u.cmd} lang="bash" />
							</div>
						</article>
					))}
				</div>

				<div className="archive-credits">
					<div className="archive-credits-copy">
						<h2>Archive credits</h2>
						<p>
							Metered runs draw from a prepaid balance. Pick a pack, pay through
							Stripe, and the CLI picks it up on the next run — your email is
							the whole account.
						</p>
					</div>
					<ArchiveCredits />
				</div>
			</section>
		</div>
	);
}
