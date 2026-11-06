import { Code } from "@/components/code/code";
import { CodeClient } from "@/components/code/code-client";
import { CodeTabs } from "@/components/code/code-tabs";
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
import { ROUND_TRIPS, hiroAddress, hiroTx, rhTx, shortAddress } from "./bridge";
import {
	ROBINHOOD_CHAIN_LOGO,
	RhFooter,
	RhHeader,
	STACKS_LOGO,
	VendorLogo,
} from "./chrome";
import { RequestedTokens } from "./requested-tokens";
import { RELAYER_READ, TWIN_MINT } from "./samples";
import { TwinsHero } from "./twins-hero";
import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = socialMeta({
	title: "Stacks to Robinhood Chain",
	description:
		"Bridge your Stacks token to Robinhood Chain and back. Each ERC-20 twin is backed one to one by the token locked on Stacks.",
	image: "/og/robinhood.png",
	path: "/robinhood",
});

const PHASES: {
	key: string;
	title: string;
	body: string;
	status: "live" | "next" | "planned";
}[] = [
	{
		key: "Phase 0",
		title: "2-of-2 custodian",
		body: "Two keys, one person. Real tokens, each with a fixed cap.",
		status: "live",
	},
	{
		key: "Phase 1",
		title: "2-of-3 federation",
		body: "A signer who isn't the builder, and a timeout so a lost key can't freeze escrow. sBTC and STX join here.",
		status: "next",
	},
	{
		key: "Phase 2",
		title: "Bond and challenge",
		body: "A watcher can stop a bad release.",
		status: "planned",
	},
	{
		key: "Phase 3",
		title: "Trustless release",
		body: "Stacks checks each release against an Ethereum root. No key signs it.",
		status: "planned",
	},
	{
		key: "Phase 4",
		title: "Trustless mint",
		body: "A lock is proven to Robinhood Chain from a Bitcoin-anchored Stacks block. No key mints.",
		status: "planned",
	},
];

/** The mainnet round trip's public txs. */
const PROOF = [
	{
		label: "Lock",
		chain: "Stacks",
		href: hiroTx(
			"0x221dd4907a062f3af9983c0fb8c3baa5620eb0a8fb02cec54449b5d91e6b13be",
		),
	},
	{
		label: "Mint",
		chain: "4663",
		href: rhTx(
			"0x0ee9e157db2be8d41806289cd6f4e7b9537bc798f0d9d0954b3ffcca51a51894",
		),
	},
	{
		label: "Burn",
		chain: "4663",
		href: rhTx(
			"0x00281d3264f2cd78184d1d21d965d4e599743da73bcb6c70f74ebe97d5c176f3",
		),
	},
	{
		label: "Release",
		chain: "Stacks",
		href: hiroTx(
			"0xfd1b6e0ece29085f15251ffb5225f1188eb68535518db78b8eb47269fc613d55",
		),
	},
];

const DRILLS = {
	replay: rhTx(
		"0x61d15e6b026b700b2c1de8bb6058d581bbf5ee946c808965af886fdeb38a00cf",
	),
	noBurn: hiroTx(
		"0x23216e13cf1435108af12f070b0554c1aca197cebd951b69473953559b630ebf",
	),
};

/** Phase 0's trust model, from robinhood-bridge NOTE.md. */
const TRUST = [
	{
		title: "The keys are the bridge",
		body: "In phase 0, release doesn't check the burn and mint doesn't check the lock.",
	},
	{
		title: "Issuers count too",
		body: "A token's own admin powers are trust in its issuer. PEPE's were renounced on chain in 2024; MEGA has none.",
	},
	{
		title: "Not a Robinhood app balance",
		body: "Never send a twin to a Robinhood deposit address.",
	},
];

/**
 * Waitlist microsite for the Stacks ⇄ Robinhood Chain SIP-010 bridge, on the
 * marketing kit (`.site`) with the standalone chrome from ./chrome (Robinhood
 * Chain logo rules are there). Robin Neon stays on the chain 4663 side of the
 * hero art.
 */
export default function RobinhoodPage() {
	return (
		<div className="site rh">
			<CodeClient />
			<RhHeader />

			<main>
				<div className="shell">
					<div className="hero">
						<div className="hero-copy">
							<Eyebrow noun="Bridge" verb="SIP-010 ⇄ ERC-20" />
							<h1>
								Don't mint a copy. <Highlight>Bridge the original.</Highlight>
							</h1>
							<p className="lede">
								Lock your Stacks token and its ERC-20 twin mints on Robinhood
								Chain. Burn the twin to bring the original home.
							</p>
							<div className="btns">
								<ButtonLink href="#join">Join the waitlist</ButtonLink>
								<ButtonLink href="#phases" variant="secondary">
									See the roadmap
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
									Each twin mints once per Stacks lock, and only while the
									locker still holds enough to back it. Locks come from
									secondlayer Streams, finalized only.
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
								<span className="cap">On chain</span>
								<p>
									Every step is a public transaction. A{" "}
									<a href={DRILLS.replay}>replayed mint</a> reverts, and a{" "}
									<a href={DRILLS.noBurn}>release with no burn</a> pays out: the
									hole, run on purpose.
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
							{ROUND_TRIPS.length > 0 && (
								<div className="rh-trips">
									<span className="cap">
										Round trips by testers · {ROUND_TRIPS.length}
									</span>
									<ol>
										{ROUND_TRIPS.map((t) => (
											<li key={t.lock}>
												<a className="mono" href={hiroAddress(t.stacksAddress)}>
													{shortAddress(t.stacksAddress)}
												</a>
												<span className="mono rh-trips-amount">
													{t.amount} {t.token}
												</span>
												<span className="rh-trips-links">
													<a href={hiroTx(t.lock)}>Lock</a>
													<a href={rhTx(t.mint)}>Mint</a>
													<a href={rhTx(t.burn)}>Burn</a>
													<a href={hiroTx(t.release)}>Release</a>
												</span>
											</li>
										))}
									</ol>
								</div>
							)}
							<p className="rh-yours">
								<strong>Add yours.</strong>{" "}
								<span>Run the round trip with MEGA or PEPE.</span>{" "}
								<Link href="/robinhood/guides/phase-0">Phase 0 guide →</Link>
							</p>
						</div>
					</div>
				</div>

				<div className="band" id="phases">
					<div className="shell">
						<div className="sec-head">
							<Eyebrow noun="Roadmap" />
							<h2>Custodial first. Keys come out one phase at a time.</h2>
						</div>
						<ol className="rh-road">
							{PHASES.map((p) => (
								<li key={p.key} className="rh-road-row">
									<span className="rh-road-key">{p.key}</span>
									<div className="rh-road-body">
										<h3>{p.title}</h3>
										<p>{p.body}</p>
									</div>
									<span className={`seal is-${p.status}`}>{p.status}</span>
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
								Caps limit what the keys can lose. They can still lose that.
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
								Tokens are added one at a time, after we've read the contract.
							</p>
							<p>
								Bridging now: MEGA and PEPE. Issuers go next, and holders show
								us where the demand is.
							</p>
							<RequestedTokens />
						</div>
						<WaitlistForm />
					</div>
				</div>
			</main>

			<RhFooter />
		</div>
	);
}
