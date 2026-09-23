import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";
import { StacksSymbol } from "./stacks-symbol";
import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = socialMeta({
	title: "Stacks to Robinhood Chain · secondlayer",
	description:
		"Bridge your Stacks token to Robinhood Chain and back. Join the waitlist for the first test rounds.",
	image: "/og/robinhood.png",
	path: "/robinhood",
});

const PHASES: {
	key: string;
	title: string;
	body: string;
	now?: boolean;
	status?: string;
}[] = [
	{
		key: "phase 0 · now",
		title: "2-of-2 custodian",
		body: "Demo token only. Proves the asset moves end to end.",
		now: true,
		// Keep in step with the Endowment decision (submitted 2026-09-22).
		status: "grant requested",
	},
	{
		key: "phase 1",
		title: "2-of-3 federation",
		body: "A signer who isn't the builder. Timeout so a lost key can't freeze the locker.",
	},
	{
		key: "phase 2",
		title: "Bond + challenge",
		body: "A watcher can stop a bad release. Still keyed.",
	},
	{
		key: "phase 3",
		title: "Trustless release",
		body: "Ethereum light client in Clarity checks the burn.",
	},
	{
		key: "phase 4",
		title: "Trustless mint",
		body: "A Bitcoin relay on Ethereum checks the Stacks lock.",
	},
];

/** The secondlayer mark (same geometry as MarketingNav), neutral ink via CSS. */
function SecondlayerMark({ width }: { width: number }) {
	return (
		<svg
			viewBox="4 7 40 28"
			width={width}
			height={Math.round(width * (28 / 40))}
			fill="none"
			aria-hidden="true"
			className="rh-mark"
		>
			<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
			<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
		</svg>
	);
}

/**
 * An official vendor logo, unmodified: the dark asset on light ground, the
 * light asset on dark ground. Theme swap is CSS-only (.rh-logo-*).
 */
function VendorLogo({
	light,
	dark,
	alt,
	height,
	ratio,
}: {
	light: string;
	dark: string;
	alt: string;
	height: number;
	ratio: number;
}) {
	const width = Math.round(height * ratio);
	return (
		<>
			<img
				className="rh-logo rh-logo-on-light"
				src={light}
				alt={alt}
				width={width}
				height={height}
			/>
			<img
				className="rh-logo rh-logo-on-dark"
				src={dark}
				alt={alt}
				width={width}
				height={height}
			/>
		</>
	);
}

const ROBINHOOD_CHAIN_LOGO = {
	light: "/robinhood-chain/logo-black.svg",
	dark: "/robinhood-chain/logo-white.svg",
	alt: "Robinhood Chain",
	ratio: 1576 / 207,
};

const STACKS_LOGO = {
	light: "/stacks/logo-black.svg",
	dark: "/stacks/logo-white.png",
	alt: "Stacks",
	ratio: 431 / 83,
};

/**
 * Waitlist microsite for the Stacks ⇄ Robinhood Chain SIP-010 bridge.
 * Standalone chrome (no MarketingNav): secondlayer mark left, the official
 * Robinhood Chain logo alone on the right. Their brand rules
 * (docs.robinhood.com/chain/brand-guidelines) forbid combining the logo with
 * other branding or text and any recolor, so it is an unmodified asset from
 * their pack, shown black on white / white on dark, never styled.
 */
export default function RobinhoodPage() {
	return (
		<div className="rh-page">
			<header className="rh-nav">
				<Link href="/" className="rh-brand">
					<SecondlayerMark width={22} />
					<span>secondlayer</span>
				</Link>
				<div className="rh-dest">
					<span className="rh-dest-label">Compatible with</span>
					<VendorLogo {...ROBINHOOD_CHAIN_LOGO} height={20} />
				</div>
			</header>

			<main>
				<section className="rh-hero">
					<div className="rh-pill">
						<b>SIP-010</b> Stacks → chain 4663 → Stacks
					</div>
					<h1>
						Don't mint a copy. <em>Bridge the original.</em>
					</h1>
					<p className="rh-lede">
						Bridge your Stacks token to Robinhood Chain and back. Lock it on
						Stacks and an ERC-20 twin mints after 6 Bitcoin confirmations. Burn
						the twin to release the original.
					</p>
					<div className="rh-cta">
						<a className="rh-btn" href="#join">
							Join the waitlist →
						</a>
						<a className="rh-btn rh-btn-ghost" href="#phases">
							What's trusted today
						</a>
					</div>
					{/* Each logo stands alone with its own clear space: Robinhood
					    Chain's rules forbid combining their mark with other
					    branding or text, so no lockup and no logo inside a sentence. */}
					<div
						className="rh-route"
						aria-label="Route: Stacks to Robinhood Chain and back"
					>
						<div className="rh-route-end">
							<VendorLogo {...STACKS_LOGO} height={17} />
							<span className="rh-route-cap">SIP-010 · locked</span>
						</div>
						<span className="rh-route-arrow" aria-hidden="true">
							⇄
						</span>
						<div className="rh-route-end">
							{/* 20px is Robinhood Chain's minimum logo height. */}
							<VendorLogo {...ROBINHOOD_CHAIN_LOGO} height={20} />
							<span className="rh-route-cap">ERC-20 · chain 4663</span>
						</div>
					</div>
				</section>

				<section className="rh-stage">
					<div className="rh-copy">
						<p className="rh-eyebrow">One round trip</p>
						<h2>Your token doesn't change. It gets a twin on another chain.</h2>
						<p>
							The original sits in a locker contract on Stacks. The ERC-20 on
							Robinhood Chain only exists while it's there. Burn the twin and
							the locker pays the original back out.
						</p>
						<dl className="rh-facts">
							<div>
								<dt>Source</dt>
								<dd>Stacks · SIP-010</dd>
							</div>
							<div>
								<dt>Destination</dt>
								<dd>Robinhood Chain · 4663</dd>
							</div>
							<div>
								<dt>Mint waits for</dt>
								<dd>6 BTC confirmations</dd>
							</div>
							<div>
								<dt>Phase 0 signers</dt>
								<dd>2-of-2</dd>
							</div>
						</dl>
					</div>
					<figure
						className="rh-twins"
						aria-label="Two token cards: 1,000 DEMO locked on Stacks as a SIP-010, and its twin, 1,000 DEMO live on Robinhood Chain as an ERC-20, linked one to one"
					>
						<div className="rh-tok">
							<span className="rh-coin rh-coin-stacks">
								<StacksSymbol size={18} />
							</span>
							<span className="rh-tok-name">DEMO</span>
							<span className="rh-tok-amt">
								1,000
								<small className="rh-state is-locked">locked</small>
							</span>
							<span className="rh-tok-meta">SIP-010 · Stacks</span>
						</div>
						<div className="rh-tok-link">
							<span className="rh-tok-rail" />
							<span className="rh-tok-link-label">
								<b>1 : 1</b> · minted after 6 BTC confirmations
								<br />
								burn the twin to unlock
							</span>
						</div>
						<div className="rh-tok">
							{/* Official Robinhood Chain feather avatar (black on Robin
							    Neon, an approved pairing), unmodified. */}
							<img
								className="rh-coin"
								src="/robinhood-chain/feather.jpg"
								alt=""
								width={36}
								height={36}
							/>
							<span className="rh-tok-name">DEMO</span>
							<span className="rh-tok-amt">
								1,000
								<small className="rh-state is-live">live</small>
							</span>
							<span className="rh-tok-meta">ERC-20 · chain 4663</span>
						</div>
					</figure>
				</section>

				<section className="rh-phases" id="phases">
					<p className="rh-eyebrow">What's trusted today</p>
					<h2>Custodial first. Keys come out one phase at a time.</h2>
					<ol className="rh-phase-grid">
						{PHASES.map((p) => (
							<li
								key={p.key}
								className={p.now ? "rh-phase is-now" : "rh-phase"}
							>
								<span className="rh-phase-key">{p.key}</span>
								<h3>{p.title}</h3>
								<p>{p.body}</p>
								{p.status && (
									<span className="rh-phase-status">{p.status}</span>
								)}
							</li>
						))}
					</ol>
					<p className="rh-note">
						<strong>Don't bridge value on phase 0.</strong> The signers hold the
						locker. Phase 1 is the earliest point a community token should move
						for real. Phase 0 is up for a Stacks Endowment grant, requested
						September 2026 and under review.
					</p>
				</section>

				<section className="rh-join" id="join">
					<div className="rh-copy">
						<p className="rh-eyebrow">Waitlist</p>
						<h2>Want your token on Robinhood Chain?</h2>
						<p>
							The waitlist decides which tokens bridge first. Tell us the token
							and how to reach you, and we'll contact you when it can join a
							test round. Issuers and teams get first pick for phase 1. Holders
							show us where the demand is.
						</p>
					</div>
					<WaitlistForm />
				</section>
			</main>

			<footer className="rh-footer">
				<span className="rh-mono">stacks ⇄ 4663</span>
				<Link href="/" className="rh-built-by">
					<span className="rh-built-by-label">Built by</span>
					<SecondlayerMark width={17} />
					<span className="rh-built-by-name">secondlayer</span>
				</Link>
				<span className="rh-tm">
					Robinhood Chain and the Robinhood Chain logo are trademarks of
					Robinhood Markets, Inc. The Stacks name and logo belong to their
					owner. Both are used here only to identify compatibility. This bridge
					is an independent project, not an official Robinhood or Stacks
					product, and is not sponsored or endorsed by either.
				</span>
			</footer>
		</div>
	);
}
