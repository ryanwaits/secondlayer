import { SectionHeading } from "@/components/section-heading";

export const welcomeMeta = {
	title: "Welcome to Writings",
	description:
		"Notes, post-mortems, and architecture pieces from the team building Second Layer.",
	date: "2026-05-06",
	year: 2026,
};

export function WelcomeContent() {
	return (
		<>
			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					This is the Writings section. We use it for short notes on
					releases, longer architecture pieces, and the occasional
					post-mortem. The goal is honest, calm prose — what we shipped, what
					we tried, what we learned.
				</p>
				<p>
					Posts here are versioned with the rest of the codebase. Each entry is
					a TSX component under{" "}
					<code>apps/web/src/app/(marketing)/writings/posts/</code> with a
					small metadata header. No CMS, no MDX bundler, no separate
					deploy.
				</p>
			</div>

			<SectionHeading id="whats-coming">What&apos;s coming</SectionHeading>

			<div className="prose">
				<ul>
					<li>An architecture article walking through the layered data plane.</li>
					<li>Per-dataset launch notes as PoX-4, sBTC, and BNS go live.</li>
					<li>Notes on the bulk dump pipeline + the cost of going public.</li>
				</ul>
			</div>
		</>
	);
}
