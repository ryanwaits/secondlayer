import { useState } from "react";
import { PoweredBy } from "./PoweredBy";

const managers = [
	{ id: "bun", command: "bun add @secondlayer/stacks" },
	{ id: "npm", command: "npm i @secondlayer/stacks" },
	{ id: "pnpm", command: "pnpm add @secondlayer/stacks" },
] as const;

type Manager = (typeof managers)[number]["id"];

function Install() {
	const [active, setActive] = useState<Manager>("bun");
	const current = managers.find((m) => m.id === active) ?? managers[0];
	return (
		<div className="sl-install">
			<div className="sl-install-tabs" role="tablist">
				{managers.map((m) => (
					<button
						aria-selected={m.id === active}
						className="sl-install-tab"
						key={m.id}
						onClick={() => setActive(m.id)}
						role="tab"
						type="button"
					>
						{m.id}
					</button>
				))}
			</div>
			<pre className="sl-install-command">
				<code>{current.command}</code>
			</pre>
		</div>
	);
}

export function Hero() {
	return (
		<section className="sl-hero">
			<div className="sl-hero-copy">
				<h1 className="sl-hero-name">
					stacks<span>.</span>
				</h1>
				<div className="sl-hero-by">
					<PoweredBy label="by" />
				</div>
				<p className="sl-hero-tagline">
					Build reliable apps &amp; libraries with <b>lightweight</b>,{" "}
					<b>composable</b>, and <b>type-safe</b> modules that interface with
					Stacks and Bitcoin
				</p>
				<div className="sl-hero-ctas">
					<a className="sl-btn sl-btn-gold" href="/getting-started">
						Get started
					</a>
					<a
						className="sl-btn"
						href="https://github.com/ryanwaits/secondlayer/tree/main/packages/stacks"
						rel="noreferrer"
						target="_blank"
					>
						GitHub
					</a>
				</div>
			</div>
			<Install />
		</section>
	);
}

const cards = [
	{
		title: "Composable",
		body: "Clients, actions, chains. Import what you use; subpath exports for pox5, sbtc, bns, simnet.",
	},
	{
		title: "Bitcoin-aware",
		body: "SPV proofs, PoX-5 staking, sBTC deposits with typed post-conditions.",
	},
	{
		title: "Typed end to end",
		body: "Clarity ABIs infer argument and return types. No any at the edge.",
	},
];

export function Cards() {
	return (
		<section className="sl-cards">
			{cards.map((c) => (
				<div className="sl-card" key={c.title}>
					<h4>{c.title}</h4>
					<p>{c.body}</p>
				</div>
			))}
		</section>
	);
}
