import { RELAYER_READ, TWIN_MINT } from "@/app/robinhood/samples";
import { AccountChip, AccountMenuPanel } from "@/components/account-menu";
import { SubgraphsEmptyState } from "@/components/account/subgraphs/empty-state";
import { SchemaView } from "@/components/account/subgraphs/schema-view";
import { exampleDetail } from "@/components/account/subgraphs/subgraph.fixtures";
import { Choice } from "@/components/choice";
import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import { BandBarChart } from "@/components/dashboard/charts/band-bar-chart";
import { Cadence } from "@/components/dashboard/charts/cadence";
import { ContextLineChart } from "@/components/dashboard/charts/context-line-chart";
import { HeatStrip } from "@/components/dashboard/charts/heat-strip";
import { Legend } from "@/components/dashboard/charts/legend";
import { Meter } from "@/components/dashboard/charts/meter";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import { SpendChart } from "@/components/dashboard/charts/spend-chart";
import { HandoffBlock } from "@/components/dashboard/insight/handoff-block";
import {
	ActionableInsights,
	InsightActions,
} from "@/components/dashboard/insight/insight-actions";
import { InsightCard } from "@/components/dashboard/insight/insight-card";
import { InsightStack } from "@/components/dashboard/insight/insight-stack";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
import { DashboardTabs } from "@/components/dashboard/shell/dashboard-tabs";
import {
	KeyFirstLine,
	PlaceholderRows,
} from "@/components/dashboard/shell/onboarding";
import {
	ResourceRow,
	ResourceRowHead,
} from "@/components/dashboard/shell/resource-row";
import {
	StatusSentence,
	type Tone,
} from "@/components/dashboard/shell/status-sentence";
import { ViewCommand } from "@/components/dashboard/shell/view-command";
import { Callout } from "@/components/docs/callout";
import { ButtonLink, Eyebrow, StatusDot } from "@/components/site";
import { ChainStatusView } from "@/components/site/chain-status";
import { type ChainTip, EMPTY_TIP } from "@/lib/chain-tip";
import { barsRows } from "@/lib/dashboard-charts";
import { FIXTURE_INSIGHTS, FIXTURE_STACK } from "@/lib/insights.fixtures";
import type { CSSProperties, ReactNode } from "react";
import {
	AmountDemo,
	HeatStripDemo,
	KeysDemo,
	OverviewOnboardingDemo,
	RowsDemo,
	RowsEmptyDemo,
	StackedCostDemo,
	SubgraphGridDemo,
	WebhookHeaderDemo,
} from "./story-controls";
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

const LAB_ACCOUNT = {
	id: "lab",
	email: "you@example.com",
	displayName: null,
	bio: null,
	avatarUrl: null,
	createdAt: "2026-04-01T00:00:00Z",
};

/** A slice of the nav bar, so the open menu hangs off a real hairline. */
const navSlice = (children: ReactNode) => (
	<div style={{ position: "relative", height: 360 }}>
		<div
			style={{
				display: "flex",
				justifyContent: "flex-end",
				alignItems: "center",
				height: 56,
				paddingRight: 16,
				borderBottom: "1px solid var(--line)",
				background: "var(--paper)",
			}}
		>
			<div
				className="acct-menu"
				style={{ "--acct-drop": "12px" } as CSSProperties}
			>
				{children}
			</div>
		</div>
	</div>
);

const FACTS = [
	["Source", "Stacks · SIP-010"],
	["Destination", "Robinhood Chain · 4663"],
	["Mint waits for", "6 BTC confirmations"],
	["Phase 0 signers", "2-of-2"],
];

type Meta = Omit<Story, keyof (typeof STORY_INDEX)[number]>;

/** A fixed clock so time-based views render the same on server and client. */
const NOW = 1_800_000_000_000;

const LAB_TIP: ChainTip = {
	...EMPTY_TIP,
	height: 9_226_704,
	avgBlockSec: 6,
	bitcoin: 971_739,
	anchor: 971_739,
	nodeTip: 9_226_704,
	okAt: NOW,
};
/** The pill in place (not fixed) with its tooltip open, so every state reads at once. */
const statusRow = (tip: ChainTip) => (
	<div className="lab-cs">
		<ChainStatusView tip={tip} now={NOW} />
	</div>
);

const SHELL_ROWS: { name: string; tone: Tone; state: string; count: string }[] =
	Array.from({ length: 40 }, (_, i) => ({
		name: i % 7 === 0 ? `vault-events-${i}` : `sbtc-deposits-${i}`,
		tone: i === 2 ? "alarm" : i % 11 === 5 ? "hi" : i % 9 === 4 ? "idle" : "ok",
		state:
			i === 2
				? "Failing since 09:14"
				: i % 9 === 4
					? "Paused"
					: "Delivering, last event 4m ago",
		count: `${(i + 1) * 137}`,
	}));

const LONG_COMMAND =
	"sl webhooks doctor sentinel:SP000000000000000000002Q6VF78.vault:~0123456789abcdef";

/** Deterministic daily rhythm for the chart stories: no randomness, no real data. */
const wave = (i: number, base: number, swing: number) =>
	Math.round(base + swing * Math.sin((((i % 24) - 15) / 24) * 2 * Math.PI));

const STORY_HOURLY = Array.from({ length: 48 }, (_, i) => ({
	n: wave(i, 46, 16),
}));
const STORY_BAND = STORY_HOURLY.map(
	({ n }) => [Math.max(0, n - 12), n + 12] as const,
);
const STORY_BAND_LABELS: [number, string][] = [
	[0, "-48h"],
	[24, "-24h"],
	[47, "now"],
];

const STORY_HEAT = Array.from({ length: 168 }, (_, i) => ({
	n: i % 31 === 0 ? 0 : wave(i, 40, 18),
	f: i >= 150 && i < 153 ? 4 : 0,
}));

const STORY_MATCHED = Array.from({ length: 36 }, (_, i) => 6 + ((i * 5) % 4));
const STORY_DELIVERED = STORY_MATCHED.map((v, i) => (i >= 18 ? 0 : v));
const STORY_LINE_LABELS: [number, string][] = [
	[0, "-6h"],
	[18, "-3h"],
	[35, "now"],
];

const STORY_SPEND_DAILY = [
	0.8, 1.1, 0.9, 1.4, 1.2, 1.0, 1.3, 1.6, 1.2, 1.5, 1.4,
];
const STORY_COST_DAYS = Array.from({ length: 14 }, (_, i) => ({
	day: `Oct ${i + 1}`,
	rows: 0.4 + (i % 4) * 0.1,
	events: 0.2 + (i % 3) * 0.05,
	storage: 0.1,
}));

const insightFor = (rule: string) => {
	const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
	if (!found) throw new Error(`missing insight fixture ${rule}`);
	return found;
};

const STORY_BLOCK_GAPS = [8, 11, 7, 9, 14, 8, 6, 9, 10, 8, 7, 12, 9, 8, 9, 10];

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
			"Beside copy, the notes hang off the outer edge; keep them short.",
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
				id: "small",
				label: "Compact (sm)",
				render: (key) => (
					<Choice
						name={`choice-sm-${key}`}
						legend="Range"
						defaultValue="48h"
						size="sm"
						options={CHOICE_MANY}
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
	"dashboard-shell": {
		src: [
			"apps/web/src/components/dashboard/shell/dashboard-tabs.tsx",
			"apps/web/src/components/dashboard/shell/view-command.tsx",
			"apps/web/src/components/marketing-nav.tsx",
		],
		rule: "Tabs and the view's CLI command in the bar, one sentence of status, and rows that never grow a background.",
		stack: true,
		variants: [
			{
				id: "shell",
				label: "Webhooks",
				render: () => (
					<div
						style={{
							height: 640,
							overflowY: "auto",
							background: "var(--paper)",
							color: "var(--ink)",
							border: "1px solid var(--line)",
							borderRadius: 8,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 28,
								height: 56,
								padding: "0 20px",
								borderBottom: "1px solid var(--line)",
							}}
						>
							<b style={{ fontWeight: 500 }}>secondlayer</b>
							<DashboardTabs pathname="/account/webhooks" failingWebhooks={1} />
							<ViewCommand command={LONG_COMMAND} />
							<AccountChip
								account={LAB_ACCOUNT}
								balance="$29.02"
								alert={false}
								open={false}
							/>
						</div>
						<div
							style={{
								display: "grid",
								gap: 28,
								padding: "32px 20px 64px",
							}}
						>
							<Breadcrumb
								parent={{ href: "/account/webhooks", label: "Webhooks" }}
								current="sbtc-deposits-2"
							/>
							<StatusSentence tone="alarm" sub="1 of 40 webhooks needs you">
								One webhook is failing
							</StatusSentence>
							<div>
								<ResourceRowHead
									labels={["Name", "State", "", "Events", "Last"]}
								/>
								{SHELL_ROWS.map((r) => (
									<ResourceRow
										key={r.name}
										href="#"
										name={r.name}
										tone={r.tone}
										kind="webhook"
										state={r.state}
										count={r.count}
										age="4m"
									/>
								))}
							</div>
						</div>
					</div>
				),
			},
		],
		usage: `<DashboardTabs pathname={pathname} failingWebhooks={1} />
<ViewCommand command={commandForPath(pathname)} />`,
		donts: ["Rows change text color on hover, never background."],
	},
	"chain-status": {
		src: ["apps/web/src/components/site/chain-status.tsx"],
		rule: "Fixed bottom-right on every page. Each mark rings once per block; down adds what stopped and whose it is. Shown here in place, tooltip open.",
		variants: [
			{
				id: "live",
				label: "Live",
				render: () => statusRow({ ...LAB_TIP, seenAt: NOW - 4_000 }),
			},
			{
				id: "stalled",
				label: "Stacks stalled",
				render: () =>
					statusRow({
						...LAB_TIP,
						seenAt: NOW - 14 * 60_000,
						bitcoin: 971_741,
					}),
			},
			{
				id: "behind",
				label: "We're behind",
				render: () =>
					statusRow({ ...LAB_TIP, seenAt: NOW - 30_000, nodeTip: 9_226_746 }),
			},
			{
				id: "unreachable",
				label: "Can't reach us",
				render: () =>
					statusRow({ ...LAB_TIP, failures: 2, okAt: NOW - 120_000 }),
			},
		],
		usage: "<ChainStatus />",
	},
	"view-command": {
		src: ["apps/web/src/components/dashboard/shell/view-command.tsx"],
		rule: "Names the CLI command for this view, in the bar. Long commands truncate in the middle; a click copies the whole thing.",
		variants: [
			{
				id: "short",
				label: "Short",
				render: () => <ViewCommand command="sl webhooks list" />,
			},
			{
				id: "long",
				label: "Long",
				render: () => <ViewCommand command={LONG_COMMAND} />,
			},
		],
		usage: '<ViewCommand command="sl webhooks list" />',
	},
	breadcrumb: {
		src: ["apps/web/src/components/dashboard/shell/breadcrumb.tsx"],
		rule: "Detail pages put the parent first; the current name is mono ink.",
		variants: [
			{
				id: "detail",
				label: "Detail",
				render: () => (
					<Breadcrumb
						parent={{ href: "/account/webhooks", label: "Webhooks" }}
						current="sbtc-deposits"
					/>
				),
			},
		],
		usage: `<Breadcrumb
  parent={{ href: "/account/webhooks", label: "Webhooks" }}
  current={webhook.name}
/>`,
	},
	"resource-row": {
		src: ["apps/web/src/components/dashboard/shell/resource-row.tsx"],
		rule: "Hover turns the name blue and the state to ink. Never a background.",
		stack: true,
		variants: [
			{
				id: "tones",
				label: "Tones",
				render: () => (
					<div>
						<ResourceRowHead labels={["Name", "State", "", "Events", "Last"]} />
						<ResourceRow
							href="#"
							name="sbtc-deposits"
							tone="ok"
							kind="webhook"
							state="Delivering, last event 4m ago"
							count="1,204"
							age="4m"
						/>
						<ResourceRow
							href="#"
							name="vault-events"
							tone="alarm"
							kind="webhook"
							state="Failing since 09:14"
							count="87"
							age="3h"
						/>
						<ResourceRow
							href="#"
							name="pool-payouts"
							tone="hi"
							kind="subgraph"
							state="Catching up, 2,140 blocks behind"
							count="9,310"
							age="1m"
						/>
						<ResourceRow
							href="#"
							name="old-listener"
							tone="idle"
							kind="webhook"
							state="Paused"
							count="0"
							age="12d"
						/>
					</div>
				),
			},
		],
		usage: `<ResourceRow href={href} name={name} tone="ok" state="Delivering" count="1,204" age="4m" />`,
	},
	"webhook-header": {
		src: ["apps/web/src/components/account/webhooks/detail-panel.tsx"],
		rule: "A webhook's name is a label you can rename here. A name another product finds it by is locked.",
		variants: [
			{
				id: "own",
				label: "Renamable",
				render: () => (
					<WebhookHeaderDemo name="sbtc-deposits" managedBy={null} />
				),
			},
			{
				id: "managed",
				label: "Named by Sentinel",
				render: () => (
					<WebhookHeaderDemo
						name="sentinel:example-watch"
						managedBy="Sentinel"
					/>
				),
			},
		],
		usage: `<TitleRow name={name} tone="ok" managedBy={webhook.managedBy} onRename={rename} />`,
		dos: ["Hover the name to reveal Rename; Enter saves, Esc cancels."],
		donts: ["Offer Rename when `managedBy` is set."],
	},
	"charts-bars": {
		src: [
			"apps/web/src/components/dashboard/charts/band-bar-chart.tsx",
			"apps/web/src/lib/dashboard-charts.ts",
		],
		rule: "Blue is the measurement, yellow marks what an insight points at, red is failure only. The soft band is the usual range.",
		stack: true,
		variants: [
			{
				id: "plain",
				label: "Plain",
				render: () => (
					<BandBarChart
						rows={barsRows(STORY_HOURLY)}
						xLabels={STORY_BAND_LABELS}
					/>
				),
			},
			{
				id: "band",
				label: "Usual range band",
				render: () => (
					<BandBarChart
						rows={barsRows(STORY_HOURLY, { band: STORY_BAND })}
						xLabels={STORY_BAND_LABELS}
					/>
				),
			},
			{
				id: "mark",
				label: "Mark and highlight",
				render: () => (
					<BandBarChart
						rows={barsRows(STORY_HOURLY, {
							band: STORY_BAND,
							highlight: [30, 31, 32],
						})}
						xLabels={STORY_BAND_LABELS}
						mark={{ index: 30, label: "Receiver down" }}
					/>
				),
			},
			{
				id: "failed",
				label: "With failures",
				render: () => (
					<BandBarChart
						rows={barsRows(
							STORY_HOURLY.map((h, i) => ({
								n: h.n,
								f: i > 40 ? 12 : 0,
							})),
						)}
						xLabels={STORY_BAND_LABELS}
					/>
				),
			},
		],
		props: [
			{
				name: "rows",
				type: "BarsRow[]",
				note: "From barsRows(series, { band, highlight }).",
			},
			{
				name: "mark",
				type: "{ index: number; label: string }",
				note: "Dashed line with a yellow pill above the plot.",
			},
		],
		usage: `<LazyBandBarChart
  rows={barsRows(series, { band, highlight: [30] })}
  xLabels={[[0, "-48h"], [47, "now"]]}
/>`,
		donts: ["No yellow for status: it only fills what an insight points at."],
	},
	"charts-heat": {
		src: ["apps/web/src/components/dashboard/charts/heat-strip.tsx"],
		rule: "One row per UTC day, one cell per hour. Opacity is volume, red is an hour with failures.",
		variants: [
			{
				id: "week",
				label: "Hover or focus a cell",
				render: () => <HeatStripDemo hours={STORY_HEAT} now={NOW} />,
			},
			{
				id: "quiet",
				label: "No clicks",
				render: () => (
					<HeatStrip
						hours={STORY_HEAT.map((c) => ({ n: c.n, f: 0 }))}
						now={NOW}
						label="Deliveries by hour, last 7 days"
					/>
				),
			},
		],
		props: [
			{
				name: "hours",
				type: "{ n: number; f: number }[168]",
				note: "Rolling window, index 0 is 167 hours before now.",
			},
			{
				name: "onCellClick",
				type: "(hourIndex: number) => void",
				note: "Omit and the click hint stays off.",
			},
		],
		usage: `<HeatStrip hours={hourly168} now={Date.now()} onCellClick={openHour} label="Deliveries by hour" />`,
	},
	"charts-lines": {
		src: ["apps/web/src/components/dashboard/charts/context-line-chart.tsx"],
		rule: "A dashed context line shows what was expected. The blue line is what arrived.",
		stack: true,
		variants: [
			{
				id: "matched",
				label: "Matched vs delivered",
				render: () => (
					<div style={{ display: "grid", gap: 10 }}>
						<Legend
							items={[
								{ swatch: "dashed", label: "Matched on chain" },
								{ swatch: "line", label: "Delivered to you" },
							]}
						/>
						<ContextLineChart
							context={STORY_MATCHED}
							values={STORY_DELIVERED}
							contextName="Matched on chain"
							valueName="Delivered to you"
							xLabels={STORY_LINE_LABELS}
						/>
					</div>
				),
			},
			{
				id: "timeout",
				label: "Against a timeout",
				render: () => (
					<ContextLineChart
						context={Array.from({ length: 14 }, () => 10)}
						values={[
							1.2, 1.3, 1.5, 1.6, 1.9, 2.1, 2.4, 2.8, 3.1, 3.6, 4, 4.6, 5.2,
							5.9,
						]}
						contextName="Our timeout"
						valueName="Your p95"
						xLabels={[
							[0, "-14d"],
							[7, "-7d"],
							[13, "today"],
						]}
						yUnit="s"
					/>
				),
			},
		],
		usage: `<LazyContextLineChart context={timeout} values={p95} contextName="Our timeout" valueName="Your p95" xLabels={labels} />`,
	},
	"charts-spend": {
		src: [
			"apps/web/src/components/dashboard/charts/spend-chart.tsx",
			"apps/web/src/components/charts/mono-stacked-bar-chart.tsx",
		],
		rule: "Cumulative spend in blue, a dashed projection at the last week's pace. Cost by unit reuses the stacked bar with the three blue steps.",
		stack: true,
		variants: [
			{
				id: "cumulative",
				label: "Cumulative with projection",
				render: () => (
					<SpendChart
						daily={STORY_SPEND_DAILY}
						daysInMonth={31}
						monthLabel="Oct"
					/>
				),
			},
			{
				id: "stacked",
				label: "Daily cost by unit",
				render: () => <StackedCostDemo data={STORY_COST_DAYS} />,
			},
		],
		usage: `<LazySpendChart daily={dailyCosts} daysInMonth={31} monthLabel="Oct" />`,
	},
	"charts-small": {
		src: [
			"apps/web/src/components/dashboard/charts/sparkline.tsx",
			"apps/web/src/components/dashboard/charts/cadence.tsx",
			"apps/web/src/components/dashboard/charts/meter.tsx",
			"apps/web/src/components/dashboard/charts/legend.tsx",
		],
		rule: "Word-scale figures: a trend, block cadence, a quota meter and the legend swatches.",
		variants: [
			{
				id: "spark",
				label: "Sparkline, failures ticked",
				render: () => (
					<Sparkline
						points={STORY_BAND.map(([, high]) => high)}
						fails={STORY_BAND.map((_, i) => (i === 30 || i === 31 ? 3 : 0))}
						title="Deliveries, last 48 hours"
					/>
				),
			},
			{
				id: "cadence",
				label: "Block cadence",
				render: () => <Cadence intervals={STORY_BLOCK_GAPS} />,
			},
			{
				id: "meter",
				label: "Meter",
				render: () => (
					<Meter
						used={640_000}
						total={1_000_000}
						label="Free rows used"
						left="640k used"
						right="1M free"
					/>
				),
			},
			{
				id: "legend",
				label: "Legend",
				render: () => (
					<Legend
						items={[
							{ swatch: "line", label: "Delivered" },
							{ swatch: "square", label: "Failed" },
							{ swatch: "band", label: "Usual range" },
							{ swatch: "dashed", label: "Matched on chain" },
						]}
					/>
				),
			},
		],
		usage: `<Sparkline points={points} fails={fails} title="Deliveries, last 48 hours" />
<Meter used={used} total={total} label="Free rows used" left="640k used" right="1M free" />`,
	},
	"insight-card": {
		src: [
			"apps/web/src/components/dashboard/insight/insight-card.tsx",
			"apps/web/src/components/dashboard/insight/evidence.tsx",
			"apps/web/src/lib/insights.ts",
		],
		rule: "We describe what we saw and hand it to the user's agent. No code fixes, and no cause below 0.85 confidence.",
		stack: true,
		variants: [
			{
				id: "down",
				label: "Receiver down",
				render: () => <InsightCard insight={insightFor("receiver_down")} />,
			},
			{
				id: "actions",
				label: "With dismiss actions",
				render: () => {
					const insight = insightFor("receiver_down");
					return (
						<InsightCard
							insight={insight}
							footer={<InsightActions insight={insight} />}
						/>
					);
				},
			},
			{
				id: "oct8",
				label: "Cause unknown",
				render: () => (
					<InsightCard insight={insightFor("dns_retries_recovered")} />
				),
			},
			{
				id: "filter",
				label: "Filter can't match",
				render: () => (
					<InsightCard insight={insightFor("filter_cannot_match")} />
				),
			},
		],
		usage:
			"<InsightCard insight={insight} footer={<InsightActions insight={insight} />} />",
		donts: [
			"No code-fix snippets in a card.",
			"No bare numbers from the model.",
		],
	},
	"insight-stack": {
		src: [
			"apps/web/src/components/dashboard/insight/insight-stack.tsx",
			"apps/web/src/components/dashboard/insight/insight-note.tsx",
			"apps/web/src/components/dashboard/insight/insight-actions.tsx",
		],
		rule: "Worst first. Only the top item opens on its own, and only when it is losing events or about to fail.",
		stack: true,
		variants: [
			{
				id: "stack",
				label: "Four insights",
				render: () => <InsightStack insights={FIXTURE_STACK} />,
			},
			{
				id: "actions",
				label: "With dismiss actions",
				render: () => <ActionableInsights insights={FIXTURE_STACK} />,
			},
			{
				id: "quiet",
				label: "Nothing opens",
				render: () => (
					<InsightStack
						insights={FIXTURE_STACK.filter(
							(i) => i.severity === "costs" || i.severity === "recovered",
						)}
					/>
				),
			},
		],
		usage: "<ActionableInsights insights={insights} />",
	},
	"account-rows": {
		src: [
			"apps/web/src/components/account/rows/rows-panel.tsx",
			"apps/web/src/lib/rows.ts",
		],
		rule: "One sentence about the free 1M, rows per day with the used-up mark, where rows came from, call sizes, and your own errors.",
		stack: true,
		variants: [
			{
				id: "exhausted",
				label: "Free 1M used up",
				render: () => <RowsDemo exhausted />,
			},
			{
				id: "under-allowance",
				label: "Under the allowance",
				render: () => <RowsDemo exhausted={false} />,
			},
		],
		usage: "<RowsSection />",
		props: [
			{
				name: "status",
				type: '"not_loaded" | "failed" | "ok"',
				note: "Failed shows the error with Retry; never a blank panel.",
			},
			{
				name: "insights",
				type: "Insight[]",
				note: "Notes under the chart. Empty renders nothing.",
			},
		],
	},
	"account-onboarding": {
		src: [
			"apps/web/src/components/dashboard/shell/onboarding.tsx",
			"apps/web/src/components/account/overview/overview-section.tsx",
			"apps/web/src/components/account/rows/rows-panel.tsx",
		],
		rule: "A new account has one job: make a key. Every empty screen points at it, then a three-step list walks to the first read and the first push.",
		stack: true,
		variants: [
			{
				id: "overview-no-key",
				label: "Overview, no key",
				render: () => <OverviewOnboardingDemo stage="no-key" />,
			},
			{
				id: "overview-key-made",
				label: "Overview, key made",
				render: () => <OverviewOnboardingDemo stage="key-made" />,
			},
			{
				id: "overview-reading",
				label: "Overview, first read done",
				render: () => <OverviewOnboardingDemo stage="reading" />,
			},
			{
				id: "key-first",
				label: "Key-first line",
				render: () => <KeyFirstLine />,
			},
			{
				id: "placeholders",
				label: "Placeholder rows",
				render: () => (
					<PlaceholderRows
						rows={[{ name: "laptop" }, { state: 55, count: 45 }]}
						note="These fill in as you go."
					/>
				),
			},
			{
				id: "rows-no-key",
				label: "Rows, no key",
				render: () => <RowsEmptyDemo noKey />,
			},
			{
				id: "rows-key",
				label: "Rows, key made",
				render: () => <RowsEmptyDemo noKey={false} />,
			},
			{
				id: "subgraphs-no-key",
				label: "Subgraphs, no key",
				render: () => <SubgraphsEmptyState noKey />,
			},
		],
		usage: "<KeyFirstLine />",
		dos: [
			"Show the key-first line only while the account has no key of its own.",
			"Keep placeholder rows faint, hidden from readers and not clickable.",
		],
		donts: ["Mint a key for the user. They name it for where it runs."],
	},
	"account-keys": {
		src: [
			"apps/web/src/components/account/keys/keys-screen.tsx",
			"apps/web/src/components/account/keys/new-key-flow.tsx",
			"apps/web/src/components/account/keys/key-view.ts",
		],
		rule: "One row per key with the rows it read; a quiet key is named with the days. A new key is shown once, with four ways to use it.",
		stack: true,
		variants: [
			{
				id: "all-in-use",
				label: "All in use",
				render: () => <KeysDemo view="all-in-use" />,
			},
			{
				id: "stale",
				label: "A key went quiet",
				render: () => <KeysDemo view="stale" />,
			},
			{
				id: "open",
				label: "Open row",
				render: () => <KeysDemo view="open" />,
			},
			{
				id: "name",
				label: "Name step",
				render: () => <KeysDemo view="name" />,
			},
			{
				id: "name-repeat",
				label: "Name already used",
				render: () => <KeysDemo view="name-repeat" />,
			},
			{
				id: "reveal",
				label: "Reveal step",
				render: () => <KeysDemo view="reveal" />,
			},
			{
				id: "empty",
				label: "No keys yet",
				render: () => <KeysDemo view="empty" />,
			},
		],
		usage: "<NewKeyFlow existingNames={names} onClose={close} />",
		props: [
			{
				name: "initial",
				type: "{ key: string; name: string }",
				note: "Opens on the reveal for a key that already exists.",
			},
			{
				name: "create",
				type: "(name: string) => Promise<string>",
				note: "Defaults to the account API. A 403 reads as the key cap, a 429 as the rate limit.",
			},
		],
	},
	"subgraph-grid": {
		src: [
			"apps/web/src/components/account/subgraphs/data-grid.tsx",
			"apps/web/src/components/account/subgraphs/row-panel.tsx",
			"apps/web/src/components/account/subgraphs/schema-view.tsx",
			"apps/web/src/lib/subgraph-view.ts",
		],
		rule: "Every row keeps the block and transaction it came from. Hover changes text color, never a background; yellow is only the new-row dot.",
		stack: true,
		variants: [
			{
				id: "rows",
				label: "Rows",
				render: () => <SubgraphGridDemo />,
			},
			{
				id: "open-row",
				label: "Open row",
				render: () => <SubgraphGridDemo openFirst />,
			},
			{
				id: "schema",
				label: "Schema",
				render: () =>
					exampleDetail.tables.transfers ? (
						<SchemaView table={exampleDetail.tables.transfers} />
					) : null,
			},
			{
				id: "empty",
				label: "Empty state",
				render: () => <SubgraphsEmptyState />,
			},
		],
		usage:
			'<DataGrid name="sbtc-deposits" table="transfers" columns={columns} rowCount={n} />',
		props: [
			{
				name: "columns",
				type: "Record<string, { type: string }>",
				note: "From the subgraph detail. Order and hidden system columns are derived.",
			},
			{
				name: "key",
				type: "string",
				note: "Mount with a key per subgraph and table so a switch starts clean.",
			},
		],
		dos: [
			"Format digit strings, never Number: values can pass 2^53.",
			"Close the live stream on unmount, sort, filter, page and hidden tabs.",
		],
		donts: ["Offer Filter on _id, _created_at or jsonb values."],
	},
	handoff: {
		src: ["apps/web/src/components/dashboard/insight/handoff-block.tsx"],
		rule: "Plain-English prompt, our own CLI commands, one Copy for agent button.",
		variants: [
			{
				id: "handoff",
				label: "With commands",
				render: () => (
					<HandoffBlock
						prompt={insightFor("receiver_down").handoff.prompt}
						commands={insightFor("receiver_down").handoff.commands}
					/>
				),
			},
			{
				id: "prompt-only",
				label: "Prompt only",
				render: () => (
					<HandoffBlock
						prompt={insightFor("polling_loop").handoff.prompt}
						commands={[]}
					/>
				),
			},
		],
		usage:
			"<HandoffBlock prompt={insight.handoff.prompt} commands={insight.handoff.commands} />",
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
	"account-menu": {
		src: ["apps/web/src/components/account-menu.tsx"],
		rule: "Rows are ink; hover turns the text blue, never a background.",
		stack: true,
		variants: [
			{
				id: "open",
				label: "Open",
				render: () =>
					navSlice(
						<>
							<AccountChip
								account={LAB_ACCOUNT}
								balance="$29.02"
								alert={false}
								open
							/>
							<AccountMenuPanel
								balance="$29.02"
								monthLabel="October"
								spent="$30.92"
							/>
						</>,
					),
			},
			{
				id: "trigger",
				label: "Trigger",
				render: () =>
					row(
						<>
							<AccountChip
								account={LAB_ACCOUNT}
								balance="$29.02"
								alert={false}
								open={false}
							/>
							<AccountChip
								account={LAB_ACCOUNT}
								balance="$0.42"
								alert
								open={false}
							/>
							<AccountChip
								account={LAB_ACCOUNT}
								balance={null}
								alert={false}
								open={false}
							/>
						</>,
					),
			},
		],
		usage: "<AccountMenu account={account} onSignOut={logout} />",
		donts: [
			"No status dot or round avatar; low balance turns the tile and amount red.",
		],
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
