import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import "../../(www)/site.css";
import "../robinhood.css";
import { RhFooter, RhHeader } from "../chrome";
import { TesterGuide } from "./guide";

export const metadata: Metadata = socialMeta({
	title: "Tester guide · Stacks to Robinhood Chain",
	description:
		"Bridge MEGA or PEPE from Stacks to Robinhood Chain and back: two transactions and about two hours. Custodial for now, so only bridge what you can lose.",
	image: "/og/robinhood-guide.png",
	path: "/robinhood/guide",
});

/**
 * The bridge's tester guide: one page that always covers the current phase
 * (old phase URLs redirect here), a single 720px column on the bridge's own
 * chrome, kept out of /docs because it belongs to this microsite.
 */
export default function GuidePage() {
	return (
		<div className="site rh">
			<RhHeader />
			<main className="shell rh-g">
				<TesterGuide />
			</main>
			<RhFooter />
		</div>
	);
}
