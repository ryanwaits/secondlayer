import { RELAYER_READ, TWIN_MINT } from "@/app/robinhood/samples";
import { Choice } from "@/components/choice";
import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import { Callout } from "@/components/docs/callout";
import { ButtonLink, Eyebrow, StatusDot } from "@/components/site";
import type { CSSProperties, ReactNode } from "react";
import { AmountDemo } from "./story-controls";
import { STORY_INDEX, type StoryId } from "./tree";

export type StoryVariant = {
	id: string;
	label: string;
	/** `key` is unique per frame, so radio groups in the light and dark frame stay apart. */
	render: (key: string) => ReactNode;
};

export type Story = (typeof STORY_INDEX)[number] & {
	/** Source files the story renders. */
	src: string[];
	/** The DESIGN.md section that holds the rules; left out where DESIGN.md is silent. */
	design?: string;
	/** One line, the rule the component exists to keep. */
	rule: string;
	variants: StoryVariant[];
	/** Container width control (px) for components that answer to their container. */
	width?: { min: number; max: number; value: number };
	/** One frame per row: the story needs more room than half the pane. */
	stack?: boolean;
	props?: { name: string; type: string; note: string }[];
	usage?: string;
	dos?: string[];
	donts?: string[];
};

const STREAM_SETUP = `const client = createStreamsClient({ apiKey });
await client.events.consume({
  types: ["print"],
  finalizedOnly: true,
});`;

const MARKED = `const tip = await node.tip();
// !mark[/finalized/]
// !callout[/finalized/] Bitcoin has confirmed this block
if (tip.finalized) await sync(tip.height);`;

const DIFFED = `// !diff -
await client.events.consume({ types: ["print"] });
// !diff +
await client.events.consume({ types: ["print"], finalizedOnly: true });`;

const VERIFY_FAIL = `$ secondlayer verify raw --against https://archive.secondlayer.tools/latest.json
⚠ 1 of 175 ranges diverge from the archive.

RANGE              DATASET  STATUS        EXPECTED  LOCAL
-----------------  -------  ------------  --------  -----
# !mark[/data differs/] red
8500000-8549999    blocks   data differs  50000     50000

These ranges hold different data than the signed archive.`;

const VERIFY_OK = `$ secondlayer verify subgraph pool-reserves --replay --from 1230000 --to 1231000
✓ pin       7f3c…a91e  handler, schema and startBlock match the deploy
✓ blocks    1,001 proven from the checkpoint (2 MARF proofs, then parent links)
✓ txs       4,812 transactions match their blocks' tx merkle roots
✓ inputs    1,001 diffs fully named; 37 writes to amm-vault-v2-01
✓ handlers  37 events, 0 handler errors, deterministic realm
✓ rows      reserves: 14 equal  digest 9a1f…03be`;

const ROLES: { token: string; means: string }[] = [
	{ token: "paper", means: "the page" },
	{ token: "ink", means: "text, solid structure" },
	{ token: "sub", means: "muted text" },
	{ token: "faint", means: "punctuation, comments, line numbers" },
	{ token: "line", means: "hairlines" },
	{ token: "soft", means: "raised surface" },
	{ token: "pri", means: "action: links, focus, current tab" },
	{ token: "hi", means: "highlight: new, finalized, signed" },
	{ token: "ok", means: "success state" },
	{ token: "alarm", means: "failures and reorgs only" },
];

const SCALE: {
	name: string;
	spec: string;
	style: CSSProperties;
	sample: string;
}[] = [
	{
		name: "Hero display",
		spec: "60 / 1.0 · 500 · -0.025em",
		style: {
			fontSize: "clamp(36px, 5vw, 60px)",
			lineHeight: 1,
			fontWeight: 500,
			letterSpacing: "-0.025em",
		},
		sample: "Instant data for apps on Bitcoin.",
	},
	{
		name: "Section heading",
		spec: "30 / 1.2 · 500 · -0.025em",
		style: {
			fontSize: 30,
			lineHeight: 1.2,
			fontWeight: 500,
			letterSpacing: "-0.025em",
		},
		sample: "Trust, and verify.",
	},
	{
		name: "Subhead",
		spec: "18 / 1.625 · sub",
		style: { fontSize: 18, lineHeight: 1.625, color: "var(--sub)" },
		sample: "An index you can check, not one you have to trust.",
	},
	{
		name: "Body",
		spec: "16 / 24 · 400",
		style: { fontSize: 16, lineHeight: "24px" },
		sample:
			"Lock it on Stacks and an ERC-20 twin mints after six confirmations.",
	},
	{
		name: "Checklist",
		spec: "14 / 1.625 · sub",
		style: { fontSize: 14, lineHeight: 1.625, color: "var(--sub)" },
		sample: "Each ERC-20 is minted against a SIP-010 the locker holds.",
	},
	{
		name: "Caption",
		spec: "12 · sub",
		style: { fontSize: 12, color: "var(--sub)" },
		sample: "Phase 0 is built and tested but not yet deployed.",
	},
	{
		name: "Mono command",
		spec: "14 / 20 · Geist Mono",
		style: {
			fontFamily: "var(--font-mono-stack)",
			fontSize: 14,
			lineHeight: "20px",
		},
		sample: "bunx @secondlayer/cli verify block 9137005",
	},
	{
		name: "Terminal body",
		spec: "12 / 1.625 · Geist Mono",
		style: {
			fontFamily: "var(--font-mono-stack)",
			fontSize: 12,
			lineHeight: 1.625,
		},
		sample: "✓ block 9,137,005 is proven",
	},
];

const CHOICE_OPTIONS = [
	{ value: "mainnet", label: "Mainnet" },
	{ value: "testnet", label: "Testnet" },
	{ value: "devnet", label: "Devnet" },
];

const CHOICE_MANY = [
	{ value: "1h", label: "1 hour" },
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
	{ value: "90d", label: "90 days" },
];

const AMOUNTS = [
	{ value: "10", label: "$10" },
	{ value: "25", label: "$25" },
	{ value: "50", label: "$50" },
	{ value: "100", label: "$100" },
];

const AMOUNTS_CAPTIONED = [
	{ value: "10", label: "$10", caption: "per month" },
	{ value: "25", label: "$25", caption: "per month" },
	{ value: "50", label: "$50", caption: "per month" },
	{ value: "100", label: "$100", caption: "per month" },
	{ value: "250", label: "$250", caption: "per month" },
	{ value: "500", label: "$500", caption: "per month" },
];

const stack = (children: ReactNode) => (
	<div className="lab-stack">{children}</div>
);

const row = (children: ReactNode) => <div className="lab-row">{children}</div>;

const FACTS = [
	["Source", "Stacks · SIP-010"],
	["Destination", "Robinhood Chain · 4663"],
	["Mint waits for", "6 BTC confirmations"],
	["Phase 0 signers", "2-of-2"],
];

type Meta = Omit<Story, keyof (typeof STORY_INDEX)[number]>;

const META: Record<StoryId, Meta> = {
	color: {
		src: ["apps/web/src/app/globals.css"],
		design: "§2 Colors",
		rule: "Blue acts, yellow marks, red fails. Neutrals carry the rest.",
		variants: [
			{
				id: "roles",
				label: "Roles",
				render: () => (
					<div className="lab-swatches">
						{ROLES.map((role) => (
							<div key={role.token} className="lab-swatch">
								<i style={{ background: `var(--${role.token})` }} />
								<code>--{role.token}</code>
								<span>{role.means}</span>
							</div>
						))}
					</div>
				),
			},
			{
				id: "rules",
				label: "Named rules",
				render: () =>
					stack(
						<>
							<p>
								<a href="#blue" style={{ color: "var(--pri)" }}>
									Blue acts
								</a>
								<span className="lab-note">
									{" "}
									a link, the current tab, focus
								</span>
							</p>
							<p>
								<span className="hl">Yellow marks</span>
								<span className="lab-note"> new, finalized, signed</span>
							</p>
							<p>
								<span style={{ color: "var(--alarm)" }}>✗ Red fails</span>
								<span className="lab-note"> a reorg, a failed check</span>
							</p>
							<p>
								Neutrals carry the rest
								<span className="lab-note"> ink, sub, faint, line, soft</span>
							</p>
						</>,
					),
			},
		],
		usage: `.card {
  background: var(--paper);
  border: 1px solid var(--line);
  color: var(--ink);
}
.card .caption {
  color: var(--sub);
}`,
		dos: [
			"Read the role tokens in new work, never literals.",
			"Set muted text with sub or the ink alpha ramp.",
			"Use the roles for what they mean: blue acts, yellow marks, red fails.",
		],
		donts: [
			"Blue never decorates data.",
			"Yellow never signals status.",
			"Red appears only for failures and reorgs.",
			"No invented grays: if it is not an action, a mark or a failure, it is ink, sub, line or soft.",
		],
	},
	type: {
		src: ["apps/web/src/app/globals.css"],
		design: "§3 Typography",
		rule: "Geist 400 and 500 only; Geist Mono for data.",
		variants: [
			{
				id: "scale",
				label: "Scale",
				render: () =>
					stack(
						SCALE.map((step) => (
							<div key={step.name} className="lab-type">
								<span className="lab-note">
									{step.name} · {step.spec}
								</span>
								<div style={step.style}>{step.sample}</div>
							</div>
						)),
					),
			},
			{
				id: "weights",
				label: "Weights and data",
				render: () =>
					stack(
						<>
							<div style={{ fontSize: 24, fontWeight: 400 }}>
								Weight 400, body
							</div>
							<div style={{ fontSize: 24, fontWeight: 500 }}>
								Weight 500, the one step up
							</div>
							<p>
								Height{" "}
								<code
									style={{
										fontFamily: "var(--font-mono-stack)",
										fontVariantNumeric: "tabular-nums",
									}}
								>
									8,740,112
								</code>{" "}
								is data, so it is mono. The sentence around it is prose.
							</p>
						</>,
					),
			},
		],
		usage: `.value {
  font-family: var(--font-mono-stack);
  font-variant-numeric: tabular-nums;
}
.heading {
  font-weight: 500;
  letter-spacing: -0.025em; /* 30px and up */
}`,
		dos: [
			"Hierarchy is size, one weight step and tracking.",
			"Set values, hashes, endpoints, heights and commands in Geist Mono with tabular-nums.",
		],
		donts: [
			"No new families: Geist and Geist Mono, full stop.",
			"No weight past 500.",
			"Prose is never mono and data is never proportional.",
		],
	},
	code: {
		src: ["apps/web/src/components/code/code.tsx"],
		design: "§2 Code surfaces",
		rule: "One renderer draws every block: a four-step ink ladder, no syntax hue.",
		variants: [
			{
				id: "barless",
				label: "Barless",
				render: () => <Code lang="sh" code="bun add @secondlayer/sdk" />,
			},
			{
				id: "titled",
				label: "Titled, lines",
				render: () => (
					<Code lang="ts" meta="consumer.ts lines" code={STREAM_SETUP} />
				),
			},
			{
				id: "mark",
				label: "Mark, callout",
				render: () => <Code lang="ts" meta="sync.ts" code={MARKED} />,
			},
			{
				id: "diff",
				label: "Diff",
				render: () => <Code lang="ts" meta="consumer.ts" code={DIFFED} />,
			},
		],
		props: [
			{
				name: "code",
				type: "string",
				note: "The source, annotations included.",
			},
			{ name: "lang", type: "string", note: "The fence language as authored." },
			{
				name: "meta",
				type: "string",
				note: "Title and options: consumer.ts lines max=20 exit=1.",
			},
			{
				name: "title",
				type: "string",
				note: "A bar title a fence cannot spell.",
			},
			{ name: "variant", type: '"docs" | "figure"', note: "Defaults to docs." },
			{
				name: "links",
				type: "boolean",
				note: "Link SDK symbols to the reference; on by default.",
			},
		],
		usage: `<Code lang="ts" meta="consumer.ts lines" code={source} />`,
		dos: [
			"Annotate only when the paragraph points at a token or line.",
			"A bare file name in the info string makes the title bar; no title, no bar.",
		],
		donts: [
			"No tinted rows, except !mark lines and lit references.",
			"Blue only in figures; red only in text output, never in source code.",
			"Removed diff lines are faint, never red.",
		],
	},
	"code-figure": {
		src: ["apps/web/src/components/code/code.tsx"],
		design: "§6 Code figure",
		rule: "Source files are figures: numbered lines, up to three margin notes.",
		stack: true,
		variants: [
			{
				id: "notes",
				label: "With notes",
				render: () => (
					<Code
						variant="figure"
						lang="sol"
						title="evm/src/Twin.sol"
						code={TWIN_MINT}
					/>
				),
			},
			{
				id: "plain",
				label: "No notes",
				render: () => (
					<Code
						variant="figure"
						lang="ts"
						title="relayer/src/sources.ts"
						code={STREAM_SETUP}
					/>
				),
			},
		],
		usage: `<Code variant="figure" lang="sol" title="evm/src/Twin.sol" code={source} />`,
		dos: [
			"At most three margin callouts, each token marked yellow.",
			"Beside copy, use the wide split so the code and its notes both fit.",
			"Show plausible real output: real heights, real commands.",
		],
		donts: [
			"No wrap, !collapse or !error in a figure; it never clamps.",
			"!mark blue only where the page's own diagram already draws the cursor in blue.",
			"Never wrap a figure in a fake browser frame.",
		],
	},
	"code-tabs": {
		src: ["apps/web/src/components/code/code-tabs.tsx"],
		design: "§6 Code figure",
		rule: "Consecutive fences become tabs; each pane keeps its own notes.",
		stack: true,
		variants: [
			{
				id: "figure",
				label: "Figure",
				render: () => (
					<CodeTabs variant="figure">
						<Code lang="sol" title="evm/src/Twin.sol" code={TWIN_MINT} />
						<Code
							lang="ts"
							title="relayer/src/sources.ts"
							code={RELAYER_READ}
						/>
					</CodeTabs>
				),
			},
			{
				id: "docs",
				label: "Docs",
				render: (key) => (
					<CodeTabs sync={key}>
						<Code
							lang="sh"
							code={
								'curl https://api.secondlayer.tools/v1/streams/events \\\n  -H "Authorization: Bearer $SECONDLAYER_API_KEY"'
							}
						/>
						<Code lang="ts" code={STREAM_SETUP} />
					</CodeTabs>
				),
			},
		],
		props: [
			{
				name: "sync",
				type: "string",
				note: "Groups with the same key on a page follow one choice.",
			},
			{ name: "variant", type: '"docs" | "figure"', note: "Defaults to docs." },
			{ name: "children", type: "<Code> fences", note: "One tab per fence." },
		],
		usage: `<CodeTabs variant="figure">
  <Code lang="sol" title="evm/src/Twin.sol" code={twin} />
  <Code lang="ts" title="relayer/src/sources.ts" code={relayer} />
</CodeTabs>`,
		dos: [
			"Each pane is its own figure; the tab bar sits above the code and notes in one frame.",
			"One Copy for the visible pane.",
			"A choice switches every group with the same sync key on the page; nothing is stored.",
			"Under 960px the notes stack under the code, with a hairline above them.",
		],
	},
	transcript: {
		src: ["apps/web/src/components/code/code.tsx"],
		design: "§2 Code surfaces",
		rule: "A transcript is a text fence that colors itself by what each line says.",
		variants: [
			{
				id: "exit-1",
				label: "Exit 1",
				render: () => (
					<Code lang="text" meta="~/secondlayer exit=1" code={VERIFY_FAIL} />
				),
			},
			{
				id: "exit-0",
				label: "Exit 0",
				render: () => (
					<Code lang="text" meta="~/pool-reserves exit=0" code={VERIFY_OK} />
				),
			},
			{
				id: "none",
				label: "No exit chip",
				render: () => (
					<Code lang="text" meta="~/pool-reserves" code={VERIFY_OK} />
				),
			},
		],
		usage: `<Code lang="text" meta="~/secondlayer exit=1" code={output} />`,
		dos: [
			"Put real CLI output in every transcript: heights, commands, verify results.",
			"Add exit=N when the exit code matters: green for 0, red otherwise.",
			"A line takes its color from what it says: ⚠ and ✗ alarm, ✓ ok, header rows faint.",
		],
		donts: [
			"No line numbers, no traffic dots, no hand-built spans.",
			"A runtime failure is a transcript, never !error; !error is for compile-time errors.",
		],
	},
	choice: {
		src: ["apps/web/src/components/choice.tsx"],
		design: "§6 Choice",
		rule: "A chosen value is ink, in joined 4px cells.",
		width: { min: 200, max: 560, value: 560 },
		variants: [
			{
				id: "three",
				label: "Three options",
				render: (key) => (
					<Choice
						name={`choice-three-${key}`}
						legend="Network"
						defaultValue="mainnet"
						options={CHOICE_OPTIONS}
					/>
				),
			},
			{
				id: "many",
				label: "Five options",
				render: (key) => (
					<Choice
						name={`choice-many-${key}`}
						legend="Window"
						defaultValue="24h"
						options={CHOICE_MANY}
					/>
				),
			},
		],
		props: [
			{ name: "name", type: "string", note: "The radio group's name." },
			{
				name: "options",
				type: "readonly { value; label }[]",
				note: "The cells, in order.",
			},
			{
				name: "legend | labelledBy",
				type: "string",
				note: "Accessible name: a hidden legend, or the id of a visible label.",
			},
			{
				name: "defaultValue",
				type: "string",
				note: "Form field: submits as radios.",
			},
			{
				name: "value + onChange",
				type: "string, (value) => void",
				note: "View switch: controlled.",
			},
		],
		usage: `<Choice
  name="network"
  legend="Network"
  defaultValue="mainnet"
  options={[
    { value: "mainnet", label: "Mainnet" },
    { value: "testnet", label: "Testnet" },
  ]}
/>`,
		dos: [
			"Form fields pass defaultValue; view switches pass value and onChange.",
			"Let a container under 310px stack the cells into one joined column: it is a container query, no script.",
		],
		donts: [
			"A chosen value is never pri: blue is the action and the current tab.",
			"One shape: 4px, joined. Full-radius pills stay for inline prose chips.",
		],
	},
	"amount-picker": {
		src: ["apps/web/src/components/amount-picker.tsx"],
		design: "§6 Amount picker",
		rule: "Selected is an ink border on a soft fill, never blue.",
		width: { min: 240, max: 640, value: 640 },
		variants: [
			{
				id: "plain",
				label: "Four amounts",
				render: (key) => (
					<AmountDemo
						name={`amount-plain-${key}`}
						options={AMOUNTS}
						initial="25"
					/>
				),
			},
			{
				id: "captioned",
				label: "Six, with captions",
				render: (key) => (
					<AmountDemo
						name={`amount-captioned-${key}`}
						options={AMOUNTS_CAPTIONED}
						initial="50"
					/>
				),
			},
		],
		props: [
			{ name: "name", type: "string", note: "The radio group's name." },
			{
				name: "options",
				type: "readonly { value; label; caption? }[]",
				note: "A caption sits under the amount in 12px sub.",
			},
			{
				name: "value",
				type: "string",
				note: "A value not in options leaves nothing selected.",
			},
			{ name: "onChange", type: "(value) => void", note: "Controlled." },
			{ name: "legend | labelledBy", type: "string", note: "Accessible name." },
		],
		usage: `<AmountPicker
  name="amount"
  legend="Amount"
  value={amount}
  onChange={setAmount}
  options={[{ value: "10", label: "$10", caption: "per month" }]}
/>`,
		dos: [
			"Four columns, two under 480px of container width.",
			"Same radios as Choice, laid out as 52px boxes.",
		],
		donts: [
			"No inset ring, no radio dot, no pri: the blue Buy button sits right under it.",
		],
	},
	tabs: {
		src: ["apps/web/src/app/globals.css"],
		design: "§6 Tabs",
		rule: "The current tab is blue: ink text on a 2px pri underline.",
		variants: [
			{
				id: "sans",
				label: "Sans",
				render: () => (
					<div className="tabbar" role="tablist">
						<button type="button" role="tab" aria-selected="true">
							Controls
						</button>
						<button type="button" role="tab" aria-selected="false">
							Props
						</button>
						<button type="button" role="tab" aria-selected="false">
							Usage
						</button>
					</div>
				),
			},
			{
				id: "mono",
				label: "Mono",
				render: () => (
					<div className="tabbar mono" role="tablist">
						<button type="button" role="tab" aria-selected="true">
							evm/src/Twin.sol
						</button>
						<button type="button" role="tab" aria-selected="false">
							relayer/src/sources.ts
						</button>
					</div>
				),
			},
			{
				id: "count",
				label: "Count badge",
				render: () => (
					<div className="tabbar" role="tablist">
						<button type="button" role="tab" aria-selected="true">
							Events <span className="n">128</span>
						</button>
						<button type="button" role="tab" aria-selected="false">
							Errors <span className="n">3</span>
						</button>
					</div>
				),
			},
		],
		usage: `<div className="tabbar mono" role="tablist">
  <button type="button" role="tab" aria-selected="true">Twin.sol</button>
  <button type="button" role="tab" aria-selected="false">sources.ts</button>
</div>`,
		dos: [
			".tabbar.mono (Geist Mono 12px) for code bars; Geist 14px for panels.",
			"The strip scrolls sideways when it overflows; markup stays the caller's.",
		],
		donts: [
			"A tab has no radius.",
			"The 2px tab underline is the only stroke heavier than 1px.",
		],
	},
	buttons: {
		src: [
			"apps/web/src/components/site/button-link.tsx",
			"apps/web/src/app/(www)/site.css",
		],
		design: "§6 Buttons",
		rule: "Flat 4px buttons: pri fill for the one action, line border for the rest.",
		variants: [
			{
				id: "kinds",
				label: "Primary, secondary",
				render: () =>
					row(
						<>
							<ButtonLink href="#primary">Join the waitlist</ButtonLink>
							<ButtonLink href="#secondary" variant="secondary">
								What's trusted today
							</ButtonLink>
							<ButtonLink href="#ghost" variant="ghost">
								Read docs
							</ButtonLink>
						</>,
					),
			},
			{
				id: "small",
				label: "Small",
				render: () =>
					row(
						<>
							<ButtonLink href="#primary" small>
								Get started
							</ButtonLink>
							<ButtonLink href="#secondary" variant="secondary" small>
								Sign in
							</ButtonLink>
						</>,
					),
			},
			{
				id: "focus",
				label: "Focus",
				render: () =>
					row(
						<>
							<a href="#focus" className="btn btn-pri lab-focus">
								Primary, focused
							</a>
							<a href="#focus" className="btn btn-sec lab-focus">
								Secondary, focused
							</a>
						</>,
					),
			},
			{
				id: "disabled",
				label: "Disabled",
				render: () =>
					row(
						<>
							<button type="button" className="btn btn-pri" disabled>
								Primary
							</button>
							<button type="button" className="btn btn-sec" disabled>
								Secondary
							</button>
						</>,
					),
			},
		],
		props: [
			{ name: "href", type: "string", note: "Where the button goes." },
			{
				name: "variant",
				type: '"primary" | "secondary" | "ghost"',
				note: "Defaults to primary.",
			},
			{ name: "small", type: "boolean", note: "The nav-sized variant." },
		],
		usage: `<ButtonLink href="#join">Join the waitlist</ButtonLink>
<ButtonLink href="#phases" variant="secondary">What's trusted today</ButtonLink>`,
		dos: [
			"Primary is 42px, 4px radius, pri fill; hover mixes 14% paper into pri.",
			"Secondary and ghost use a line border; hover darkens it to ink or sub.",
			"Small is 34px; the nav Start free uses it.",
			"Disabled is 50% opacity; press scales to 0.97, off under reduced motion.",
			"Focus is a 2px pri outline, 2px offset, on :focus-visible so a mouse click never draws it.",
		],
		donts: [
			"No pills, no ink fills.",
			"No transition on focus, no glow, no transition: all.",
		],
	},
	callout: {
		src: ["apps/web/src/components/docs/callout.tsx"],
		rule: "A plain surface, line border and paper fill; state is a leading dot plus the words.",
		variants: (
			[
				["note", "Note"],
				["tip", "Tip"],
				["warning", "Warning"],
				["danger", "Danger"],
			] as const
		).map(([type, title]) => ({
			id: type,
			label: title,
			render: () => (
				<Callout type={type} title={title}>
					<p>Archive-first: a self-hosted node never backfills on its own.</p>
				</Callout>
			),
		})),
		props: [
			{
				name: "type",
				type: '"note" | "tip" | "info" | "warning" | "danger"',
				note: "Sets the leading dot: hollow ring for note, ok for tip, alarm for warning and danger.",
			},
			{ name: "title", type: "ReactNode", note: "Optional bold lead line." },
			{ name: "id", type: "string", note: "Anchor for deep links." },
		],
		usage: `<Callout type="warning" title="Phase 0">
  Don't bridge value on Phase 0.
</Callout>`,
	},
	"eyebrow-facts": {
		src: [
			"apps/web/src/components/site/eyebrow.tsx",
			"apps/web/src/components/site/status-dot.tsx",
			"apps/web/src/app/robinhood/robinhood.css",
		],
		design: "§2 Colors",
		rule: "Status is an ok fill or a hollow neutral ring; yellow never signals status.",
		variants: [
			{
				id: "eyebrow",
				label: "Eyebrow",
				render: () =>
					stack(
						<>
							<Eyebrow noun="Index" verb="decodes" />
							<Eyebrow noun="Bridge" verb="SIP-010 ⇄ ERC-20" />
							<Eyebrow noun="Waitlist" />
						</>,
					),
			},
			{
				id: "facts",
				label: "Facts",
				render: () => (
					<dl className="rh-facts">
						{FACTS.map(([term, value]) => (
							<div key={term}>
								<dt>{term}</dt>
								<dd>{value}</dd>
							</div>
						))}
					</dl>
				),
			},
			{
				id: "status",
				label: "Status dots",
				render: () =>
					row(
						<>
							<StatusDot state="live" />
							<StatusDot state="rolling" />
							<StatusDot state="soon" />
						</>,
					),
			},
		],
		props: [
			{ name: "Eyebrow noun", type: "string", note: "The mono tag." },
			{
				name: "Eyebrow verb",
				type: "string",
				note: "The product's one verb, after a dot.",
			},
			{
				name: "StatusDot state",
				type: '"live" | "rolling" | "soon"',
				note: "live is an ok fill; the others a hollow ring.",
			},
		],
		usage: `<Eyebrow noun="Index" verb="decodes" />
<StatusDot state="live" />`,
		donts: ["Yellow never signals status."],
	},
};

export const STORIES: Story[] = STORY_INDEX.map((entry) => ({
	...entry,
	...META[entry.id],
}));

export function getStory(id: string): Story | undefined {
	return STORIES.find((story) => story.id === id);
}
