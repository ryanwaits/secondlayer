import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import "../../../(www)/site.css";
import "../../robinhood.css";
import { RhFooter, RhHeader } from "../../chrome";
import { PhaseZeroGuide } from "./guide";
import { GuideRail, type RailStep } from "./rail";

export const metadata: Metadata = socialMeta({
	title: "Phase 0 guide · Stacks to Robinhood Chain",
	description:
		"Bridge MEGA or PEPE from Stacks to Robinhood Chain and back: two transactions and about two hours. Custodial for now, so only bridge what you can lose.",
	image: "/og/robinhood.png",
	path: "/robinhood/guides/phase-0",
});

/** The guide's sections, in page order: the rail links to each. */
const STEPS: readonly RailStep[] = [
	{ id: "before", n: "0", title: "Before you start", who: "read · 2 min" },
	{ id: "lock", n: "1", title: "Lock on Stacks", who: "you · 1 tx" },
	{ id: "mint", n: "2", title: "Wait for the twin", who: "~70 min + approval" },
	{ id: "burn", n: "3", title: "Burn to come home", who: "you · 1 tx" },
	{
		id: "release",
		n: "4",
		title: "Wait for the release",
		who: "~20 min + approval",
	},
	{ id: "record", n: "5", title: "On the record", who: "automatic" },
];

/**
 * Phase 0 tester guide for the bridge: the docs' page anatomy (step rail +
 * one 720px article) on the bridge's own chrome, kept out of /docs because
 * it belongs to this microsite.
 */
export default function PhaseZeroGuidePage() {
	return (
		<div className="site rh">
			<RhHeader />
			<main className="shell rh-g">
				<GuideRail steps={STEPS} />
				<PhaseZeroGuide />
			</main>
			<RhFooter />
		</div>
	);
}
