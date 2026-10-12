import { Eyebrow } from "@/components/site";
import type { Metadata } from "next";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
	title: "Contact",
	description:
		"Volume pricing, contracts and sizing help. A person reads every message and replies from their own inbox.",
};

const REASONS = [
	"Volume pricing past 1B rows a month",
	"Invoices, terms and a signed agreement",
	"Help sizing a self-hosted box",
] as const;

export default async function ContactPage({
	searchParams,
}: {
	searchParams: Promise<{ from?: string | string[] }>;
}) {
	const { from: raw } = await searchParams;
	const from = typeof raw === "string" && raw.startsWith("/") ? raw : undefined;

	return (
		<main className="site contact">
			<div className="shell">
				<div className="contact-grid">
					<div className="contact-copy">
						<Eyebrow noun="Contact" />
						<h2>Tell us what you're building.</h2>
						<p className="lede">
							A person reads every message and replies from their own inbox,
							usually within one business day.
						</p>
						<ul className="contact-reasons">
							{REASONS.map((reason) => (
								<li key={reason}>{reason}</li>
							))}
						</ul>
					</div>
					<ContactForm from={from} />
				</div>
			</div>
		</main>
	);
}
