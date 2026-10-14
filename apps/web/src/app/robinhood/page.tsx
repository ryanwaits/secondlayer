import { Code } from "@/components/code/code";
import { CodeClient } from "@/components/code/code-client";
import { CodeTabs } from "@/components/code/code-tabs";
import { Logo } from "@/components/logo";
import {
	ButtonLink,
	Eyebrow,
	Highlight,
	Props,
	Split,
} from "@/components/site";
import { HistoryIcon, LockIcon, UndoIcon } from "@/components/site/icons";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";
import "../(www)/site.css";
import "./robinhood.css";
import { RequestedTokens } from "./requested-tokens";
import { RELAYER_READ, TWIN_MINT } from "./samples";
import { TwinsHero } from "./twins-hero";
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
		key: "Phase 0",
		title: "2-of-2 custodian",
		body: "Demo token only. Proves the asset moves end to end.",
		now: true,
		// Keep in step with the Endowment decision (not awarded as of 2026-10-13).
		status: "built · grant pending",
	},
	{
		key: "Phase 1",
		title: "2-of-3 federation",
		body: "A signer who isn't the builder. Timeout so a lost key can't freeze the locker.",
	},
	{
		key: "Phase 2",
		title: "Bond + challenge",
		body: "A watcher can stop a bad release. Still keyed.",
	},
	{
		key: "Phase 3",
		title: "Trustless release",
		body: "Ethereum light client in Clarity checks the burn.",
	},
	{
		key: "Phase 4",
		title: "Trustless mint",
		body: "A Bitcoin relay on Ethereum checks the Stacks lock.",
	},
];

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
 * Waitlist microsite for the Stacks ⇄ Robinhood Chain SIP-010 bridge, on the
 * marketing kit (`.site`) with standalone chrome (no MarketingNav):
 * secondlayer mark left, the official Robinhood Chain logo alone on the right.
 * Their brand rules (docs.robinhood.com/chain/brand-guidelines) forbid
 * combining the logo with other branding or text and any recolor, so it is an
 * unmodified asset from their pack, shown black on white / white on dark,
 * never styled. Robin Neon stays on the chain 4663 side of the hero art.
 */
export default function RobinhoodPage() {
	return (
		<div className="site rh">
			<CodeClient />
			<header className="rh-nav">
				<div className="shell">
					<Link href="/" className="rh-brand">
						<Logo size={22} />
						<span>secondlayer</span>
					</Link>
					<div className="rh-dest">
						<span className="cap rh-dest-label">Compatible with</span>
						<VendorLogo {...ROBINHOOD_CHAIN_LOGO} height={20} />
					</div>
				</div>
			</header>

			<main>
				<div className="shell">
					<div className="hero">
						<div className="hero-copy">
							<Eyebrow noun="Bridge" verb="SIP-010 ⇄ ERC-20" />
							<h1>
								Don't mint a copy. <Highlight>Bridge the original.</Highlight>
							</h1>
							<p className="lede">
								Bridge your Stacks token to Robinhood Chain and back. Lock it on
								Stacks and an ERC-20 twin mints after 6 Bitcoin confirmations.
								Burn the twin to release the original.
							</p>
							<div className="btns">
								<ButtonLink href="#join">Join the waitlist</ButtonLink>
								<ButtonLink href="#phases" variant="secondary">
									What's trusted today
								</ButtonLink>
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
									<span className="cap">SIP-010 · locked</span>
								</div>
								<span className="rh-route-arrow" aria-hidden="true">
									⇄
								</span>
								<div className="rh-route-end">
									{/* 20px is Robinhood Chain's minimum logo height. */}
									<VendorLogo {...ROBINHOOD_CHAIN_LOGO} height={20} />
									<span className="cap">ERC-20 · chain 4663</span>
								</div>
							</div>
						</div>
						<div className="hero-art">
							<TwinsHero />
						</div>
					</div>

					<Props
						items={[
							{
								icon: <LockIcon />,
								title: "Backed one to one",
								body: "Each ERC-20 is minted against a SIP-010 the locker holds. No lock, no mint.",
							},
							{
								icon: <HistoryIcon />,
								title: "Mints wait for Bitcoin",
								body: "A twin mints only after its lock has 6 Bitcoin confirmations.",
							},
							{
								icon: <UndoIcon />,
								title: "Burn to come home",
								body: "Burning the twin releases the original on Stacks to the address you name.",
							},
						]}
					/>
				</div>

				<div className="band band-soft">
					<div className="shell">
						<div className="rh-rt-head">
							<div>
								<Eyebrow noun="1:1 backing" />
								<h2>No lock, no mint. In code.</h2>
								<p className="lede">
									The twin on Robinhood Chain mints only against a lock on
									Stacks, once per lock, and only from the Phase 0 signers. The
									relayer finds each lock through secondlayer Streams, finalized
									only.
								</p>
							</div>
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
						<CodeTabs variant="figure">
							<Code lang="sol" title="evm/src/Twin.sol" code={TWIN_MINT} />
							<Code
								lang="ts"
								title="relayer/src/sources.ts"
								code={RELAYER_READ}
							/>
						</CodeTabs>
					</div>
				</div>

				<div className="band" id="phases">
					<div className="shell">
						<div className="sec-head">
							<Eyebrow noun="What's trusted today" />
							<h2>Custodial first. Keys come out one phase at a time.</h2>
						</div>
						<ol className="rh-phases">
							{PHASES.map((p) => (
								<li
									key={p.key}
									className={p.now ? "rh-phase is-now" : "rh-phase"}
								>
									<span className="rh-phase-key">
										{p.key}
										{p.now && <span className="seal">now</span>}
									</span>
									<h3>{p.title}</h3>
									<p>{p.body}</p>
									{p.status && (
										<span className="status soon">
											<i />
											{p.status}
										</span>
									)}
								</li>
							))}
						</ol>
						<p className="rh-note">
							<i />
							<span>
								<strong>Don't bridge value on Phase 0.</strong> The signers hold
								the locker. Phase 1 is the earliest point a community token
								should move for real. Phase 0 is built and tested but not yet
								deployed, and its Stacks Endowment grant is still under review.
							</span>
						</p>
					</div>
				</div>

				<div className="band band-soft" id="join">
					<div className="shell rh-join">
						<div className="copy">
							<Eyebrow noun="Waitlist" />
							<h2>Want your token on Robinhood Chain?</h2>
							<p>
								Tokens are added one at a time. Each gets its own registry entry
								once we've checked its supply can't be minted around the bridge.
							</p>
							<p>
								The waitlist sets the order. Issuers and teams go first for
								Phase 1; holders show us where the demand is.
							</p>
							<RequestedTokens />
						</div>
						<WaitlistForm />
					</div>
				</div>
			</main>

			<footer className="rh-footer">
				<div className="shell">
					<span className="mono">stacks ⇄ 4663</span>
					<Link href="/" className="rh-built-by">
						<span>Built by</span>
						<Logo size={17} />
						<span className="rh-built-by-name">secondlayer</span>
					</Link>
					<span className="rh-tm">
						Robinhood Chain and the Robinhood Chain logo are trademarks of
						Robinhood Markets, Inc. The Stacks name and logo belong to their
						owner. Both are used here only to identify compatibility. This
						bridge is an independent project, not an official Robinhood or
						Stacks product, and is not sponsored or endorsed by either.
					</span>
				</div>
			</footer>
		</div>
	);
}
