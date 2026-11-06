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
	title: "Stacks to Robinhood Chain",
	description:
		"Bridge your Stacks token to Robinhood Chain and back. Rehearsed end to end on testnet, mainnet next. Join the waitlist.",
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
		body: "A demo token for the grant evidence, plus a capped pilot of real tokens.",
		now: true,
		status: "testnet done · mainnet next",
	},
	{
		key: "Phase 1",
		title: "2-of-3 federation",
		body: "A third signer who isn't the builder, and a timeout so a lost key can't freeze escrow. Capped sBTC (as slsBTC, never bare sBTC) and STX join here.",
	},
	{
		key: "Phase 2",
		title: "Bond + challenge",
		body: "A watcher can stop a bad release. Still keyed.",
	},
	{
		key: "Phase 3",
		title: "Trustless release",
		body: "Stacks checks each release against an Ethereum root, so no key signs it.",
	},
	{
		key: "Phase 4",
		title: "Trustless mint",
		body: "A lock is proven to Robinhood Chain from a Bitcoin-anchored Stacks block, so the Safe stops being the minter. sBTC and STX take the same path.",
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

const HIRO_TX = "https://explorer.hiro.so/txid/";
const RH_TX = "https://explorer.testnet.chain.robinhood.com/tx/";

/** The testnet rehearsal's public txs (robinhood-bridge proof/m2.json). */
const PROOF = [
	{
		label: "Lock",
		chain: "Stacks",
		href: `${HIRO_TX}0x00504c4ec6ea9c5897df53cb360f63aa7fecf79ebc8fc6e16c3236c220fb4fd3?chain=testnet`,
	},
	{
		label: "Mint",
		chain: "46630",
		href: `${RH_TX}0xdedc6cf7bd62632a95808c5a4a1b0b9aa26da08202b48fd9753b43467b570504`,
	},
	{
		label: "Burn",
		chain: "46630",
		href: `${RH_TX}0xd02c48f5f1d03e472ee7867efd79f450796c1638fe394fdfc4f2dfa268cea1af`,
	},
	{
		label: "Release",
		chain: "Stacks",
		href: `${HIRO_TX}0x9bbd53c1ae0daedeef60943649f05defb4c15afe67b6e7f9ad4e48fb2f2f03c3?chain=testnet`,
	},
	{
		label: "PEPE release",
		chain: "Stacks",
		href: `${HIRO_TX}0x1623c67155700e45cb7992b89bf8f36818a0b7530a126f0cfdbd2f704dd87486?chain=testnet`,
	},
];

const DRILLS = {
	replay: `${RH_TX}0x4ca40351d02d2524b82e974d779468c589a55b375ecda3f3363d17665a63c261`,
	noBurn: `${HIRO_TX}0x951bd47980058f1c3104deb717835c72fae44453fc6339cda865e1a415931429?chain=testnet`,
};

/** Phase 0's trust model, from robinhood-bridge NOTE.md. */
const TRUST = [
	{
		title: "One person, both keys",
		body: "A 2-of-2 multisig on Stacks and a 2-of-2 Safe on Robinhood Chain, held by the builder on two devices.",
	},
	{
		title: "The keys are the bridge",
		body: "Release doesn't check the burn and mint doesn't check the lock. Neither chain can read the other.",
	},
	{
		title: "The issuer counts too",
		body: "A token's admin powers add trust in its issuer. PEPE's owner can grant a role that moves any holder's balance, escrow included.",
	},
	{
		title: "Backing stops new mints",
		body: "If escrow falls short, the relayer stops minting that token. It doesn't restore what's already bridged.",
	},
];

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
								Burn the twin to release the original. It ran end to end on
								testnet. Mainnet is next and isn't live yet.
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
								body: "Each token gets its own ERC-20 at the same decimals, minted against what the locker holds, up to a cap fixed at register.",
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
								<h2>One mint per lock, signed by both keys.</h2>
								<p className="lede">
									The twin mints once per Stacks lock, and only from the 2-of-2
									Safe. It can't read Stacks, so the keys are what tie a mint to
									a real lock. The relayer finds each lock through secondlayer
									Streams, finalized only, and checks the locker still backs it
									before it signs.
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
									<dt>Cap per token</dt>
									<dd>fixed at register</dd>
								</div>
								<div>
									<dt>Phase 0 signers</dt>
									<dd>2-of-2 · one person</dd>
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
						<div className="rh-proof">
							<div className="rh-proof-head">
								<span className="cap">Rehearsed on testnet</span>
								<p>
									Stacks testnet and Robinhood Chain testnet (46630), with a
									Ledger as the second key. A{" "}
									<a href={DRILLS.replay}>replayed mint</a> reverted on chain. A{" "}
									<a href={DRILLS.noBurn}>release with no burn</a> paid out, on
									purpose: that's the hole below.
								</p>
							</div>
							<ol className="rh-proof-list">
								{PROOF.map((t) => (
									<li key={t.label}>
										<a href={t.href}>
											<span>{t.label}</span>
											<span className="mono">{t.chain}</span>
										</a>
									</li>
								))}
							</ol>
						</div>
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
						<ul className="rh-trust">
							{TRUST.map((t) => (
								<li key={t.title}>
									<h3>{t.title}</h3>
									<p>{t.body}</p>
								</li>
							))}
						</ul>
						<p className="rh-note">
							<i />
							<span>
								<strong>Don't bridge anything you can't afford to lose.</strong>{" "}
								Real tokens are capped, so the keys can lose at most a token's
								cap. They can still lose that.
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
								Tokens are added one at a time, once we've read the token's
								contract. Both keys register each one with its own ERC-20 and
								cap. A token that takes a fee on transfer is refused.
							</p>
							<p>
								The waitlist sets the order. PEPE and MEGA, the most requested,
								are planned first, capped. Issuers and teams go next; holders
								show us where the demand is.
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
