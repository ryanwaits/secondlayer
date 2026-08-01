import {
	AnnotatedCode,
	AnnotatedPayload,
	BarChart,
	BeforeAfter,
	CellStrip,
	CodeDiff,
	CopyBlock,
	CrossHighlight,
	DeltaBars,
	Distribution,
	FlowLoop,
	HeatCalendar,
	InlineSpark,
	InvariantList,
	LayerStack,
	Lifecycle,
	LineChart,
	Matrix,
	PipelineFlow,
	PositionTrack,
	Predict,
	ScenarioToggle,
	SequenceDiagram,
	Sidenote,
	SmallMultiples,
	SourceQuote,
	SpecSheet,
	StatTile,
	StateRow,
	StepThrough,
	Term,
	TermPair,
	Timeline,
	TreeWalk,
} from "@/components/figures";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SelectivityExplorer } from "../(post)/checkpoint-receipt-not-bookmark/selectivity-explorer";

export const metadata: Metadata = {
	title: "Figure library — secondlayer writings",
	description:
		"The reusable visual vocabulary for writings posts: every figure a post can reach for, as live reference implementations.",
	robots: { index: false, follow: false },
};

function Specimen({
	id,
	name,
	tier,
	use,
	children,
}: {
	id: string;
	name: ReactNode;
	tier: string;
	use: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="figcat-specimen">
			<div className="figcat-head">
				<span className="figcat-id">{id}</span>
				<span className="figcat-name">{name}</span>
				<span className="spacer" />
				<span className="figcat-tier">{tier}</span>
			</div>
			<div className="figcat-body">{children}</div>
			<div className="figcat-use">{use}</div>
		</div>
	);
}

function Cat({
	code,
	title,
	note,
}: { code: string; title: string; note: string }) {
	return (
		<>
			<h2 className="figcat-cat">
				<span className="cat-code">{code}</span> {title}
			</h2>
			<p className="figcat-note">{note}</p>
		</>
	);
}

// C1 demo data: event age climbing near 39k, backlog at ~0, deterministic.
const C1_POINTS = Array.from({ length: 41 }, (_, i) => {
	const t = 9 + (i / 40) * 10;
	return {
		t,
		a: Math.round((Math.sin(i) + 1) * 3),
		b: Math.round(39280 + (t - 9) * 8.2 + Math.sin(i * 1.7) * 6),
	};
});

// C8 demo data: dense early weeks fading to an empty recent month.
const C8_WEEKS = Array.from({ length: 8 }, (_, w) =>
	Array.from({ length: 7 }, (_, d) =>
		w < 3
			? Math.floor(Math.abs(Math.sin(w * 7 + d * 3)) * 3.9)
			: w === 3 && d < 2
				? 1
				: 0,
	),
);

export default function FigureLibraryPage() {
	return (
		<main className="figcat-wrap">
			<h1 className="figcat-title">Figure library</h1>
			<p className="figcat-lede">
				The reusable visual vocabulary for writings posts: every figure a post
				can reach for, as live reference implementations. Four tiers, from quiet
				text structures to one-per-post interactive explorers. Two production
				components are adopted, not forked.
			</p>
			<div className="figcat-principles">
				<span className="figcat-principle">
					<b>tokens</b> site palette, both themes
				</span>
				<span className="figcat-principle">
					<b>color = role</b> constant per post, never cycled
				</span>
				<span className="figcat-principle">
					<b>validated</b> CVD-checked pairs only
				</span>
				<span className="figcat-principle">
					<b>labels</b> collision-managed at every state
				</span>
				<span className="figcat-principle">
					<b>motion</b> reduced-motion fallback always
				</span>
				<span className="figcat-principle">
					<b>touch</b> hover never load-bearing
				</span>
			</div>

			<Cat
				code="A"
				title="Text-first"
				note="Structure doing the explaining, with subtle or no interactivity. Cheapest to author, most reusable. Default here before reaching for a chart."
			/>

			<Specimen
				id="A1"
				name={
					<>
						<code>&lt;StatTile&gt;</code>: the number is the point
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> one value carries the argument. Tabular numerals,
						optional spark with emphasized endpoint. Never three tiles saying
						the same thing.
					</>
				}
			>
				<StatTile
					tiles={[
						{ label: "backlog", value: "0", sub: "caught up", subTone: "good" },
						{
							label: "index seeks / poll",
							value: "1",
							sub: "constant, any cursor age",
						},
						{
							label: "event age",
							value: "39,438",
							sub: "blocks · grows on quiet feeds",
							spark: [0, 1, 2, 3, 4],
							sparkRole: "b",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="A2"
				name={
					<>
						<code>&lt;TermPair&gt;</code>: two concepts held apart
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> a post rests on a two-way distinction. The role
						colors established here follow both terms through every later figure
						in the post.
					</>
				}
			>
				<TermPair
					a={{
						term: "receipt",
						body: "What I have safely stored. Durable, transactional, points at a row you hold.",
					}}
					b={{
						term: "bookmark",
						body: "Where I was looking. Ephemeral, recomputed by the first poll, free to lose.",
					}}
				/>
			</Specimen>

			<Specimen
				id="A3"
				name={
					<>
						<code>&lt;Matrix&gt;</code>: tradeoff grid with cost chips
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> the point is an asymmetry of consequences. Semantic
						chip colors (ok/alarm) are separate from role colors and never
						reused as series.
					</>
				}
			>
				<Matrix
					cells={[
						{
							kicker: "you lose the",
							title: "bookmark",
							role: "b",
							body: <p>One free question on restart.</p>,
							cost: { label: "~1ms, once", tone: "cheap" },
						},
						{
							kicker: "you lose the",
							title: "receipt",
							role: "a",
							body: <p>Duplicates or silent gaps.</p>,
							cost: { label: "your data", tone: "dear" },
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="A4"
				name={
					<>
						<code>&lt;AnnotatedPayload&gt;</code>: a wire shape, explained in
						place
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> explaining a JSON/wire shape field by field. Hover
						or focus a field to light its note; on touch, tap toggles. Fields
						are real buttons, keyboard reachable.
					</>
				}
			>
				<AnnotatedPayload
					segments={[
						'{\n  "checkpoint": ',
						{ id: "n1", text: '"8637064:1"' },
						',\n  "last_delivered_height": ',
						{ id: "n2", text: "8637064" },
						',\n  "scanned_height": ',
						{ id: "n3", text: "8676502" },
						',\n  "blocks_behind": ',
						{ id: "n4", text: "0" },
						"\n}",
					]}
					notes={[
						{
							id: "n1",
							label: "checkpoint",
							body: "the receipt, last delivered cursor, committed with your rows.",
						},
						{
							id: "n2",
							label: "last_delivered_height",
							body: "event recency; parks on a quiet filter.",
						},
						{
							id: "n3",
							label: "scanned_height",
							body: "verified-through position; rides the tip when caught up.",
						},
						{
							id: "n4",
							label: "blocks_behind",
							body: "tip − scanned. Backlog, not event age.",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="A5"
				name={
					<>
						<code>&lt;Sidenote&gt;</code>: precision without derailing
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a hedge, source, or precision upgrade would break
						the paragraph&rsquo;s stride. ≥1100px the note lives in the right
						margin beside its reference (as in a post; shown inline here);
						narrower viewports tap to expand inline.
					</>
				}
			>
				<p className="fig-prose">
					The catalog seeks to your cursor in logarithmic time
					<Sidenote n={1}>
						B-tree index on <code>(filter, cursor)</code>; the seek is O(log n)
						over the event count, not the block count.
					</Sidenote>{" "}
					and reads forward, so a poll costs the same at any cursor age.
				</p>
			</Specimen>

			<Specimen
				id="A6"
				name={
					<>
						<code>&lt;AnnotatedCode&gt;</code>: logic, explained line by line
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> the argument is the ORDER of operations. A4&rsquo;s
						sibling: payloads get field notes, logic gets line notes. Lines are
						buttons; hover, focus, or tap.
					</>
				}
			>
				<AnnotatedCode
					lines={[
						{ code: "await driver.transact(async (tx) => {", note: "a6n1" },
						{ code: "  await driver.acquireLock?.(tx);", note: "a6n2" },
						{ code: "  await write(tx);", note: "a6n3" },
						{ code: "  await driver.writeCursor(tx, cursor);", note: "a6n4" },
						{ code: "});", note: "a6n1" },
					]}
					notes={[
						{
							id: "a6n1",
							label: "one transaction",
							body: "everything inside commits together or not at all.",
						},
						{
							id: "a6n2",
							label: "lock first",
							body: "a second writer fails loudly here, before touching data.",
						},
						{
							id: "a6n3",
							label: "the handler's rows",
							body: "user inserts go through the lent tx.",
						},
						{
							id: "a6n4",
							label: "cursor last, same tx",
							body: "the receipt rides with the rows it describes.",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="A7"
				name={
					<>
						<code>&lt;CodeDiff&gt;</code>: what changed, tinted
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a migration or fix is the story. Deletions tinted
						alarm, additions tinted ok, both at 8%: semantic colors, never the
						role palette. The &ldquo;result&rdquo; view is what a reader copies.
					</>
				}
			>
				<CodeDiff
					lines={[
						{ text: "SELECT pg_try_advisory_xact_lock(" },
						{
							text: "  hashtext($1)   -- int4: collides across ids",
							op: "del",
						},
						{ text: "  hashtextextended($1, 0)   -- int8", op: "add" },
						{ text: ")" },
					]}
					result={[
						"SELECT pg_try_advisory_xact_lock(",
						"  hashtextextended($1, 0)",
						")",
					]}
				/>
			</Specimen>

			<Specimen
				id="A8"
				name={
					<>
						<code>&lt;InvariantList&gt;</code>: numbered contracts, expandable
						failure stories
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a contract has numbered obligations. Each row is
						anchor-linkable (<code>#inv-9</code>), so docs and reviews can cite
						an invariant by URL. Click expands the failure story: the reason the
						rule exists.
					</>
				}
			>
				<InvariantList
					items={[
						{
							id: "inv-4",
							n: 4,
							title: "Rows and cursor commit in one transaction",
							body: "Committed separately, a crash between the two either re-delivers the batch (duplicates) or skips it (a gap), depending on which write landed first. The classic torn-batch bug.",
						},
						{
							id: "inv-9",
							n: 9,
							title: "Rollback deletes at or above the fork, inclusive",
							body: (
								<>
									The new canonical chain re-supplies the fork block itself. An
									exclusive <code>&gt;</code> leaves one block of orphaned rows
									that survives the fork forever, silently.
								</>
							),
						},
						{
							id: "inv-11",
							n: 11,
							title: "Scope the undo by fork height, never the rewind cursor",
							body: "On a multi-fork page every rollback call carries the same rewind cursor but its own fork height. A sink that derives the delete range from the cursor under-deletes, silently.",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="A9"
				name={
					<>
						<code>&lt;Term&gt;</code>: hover-defined vocabulary
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a post coins terms and readers may land mid-page.
						Dotted underline signals &ldquo;defined here&rdquo;; hover on
						pointer devices, tap or focus elsewhere. One glossary per post keeps
						definitions identical at every mention.
					</>
				}
			>
				<p className="fig-prose">
					The{" "}
					<Term
						label="receipt"
						def="What the consumer has safely stored: the last delivered cursor, committed transactionally with your rows."
					>
						receipt
					</Term>{" "}
					stays parked while the{" "}
					<Term
						label="bookmark"
						def="Where the scan has verified through. Ephemeral; recomputed by the first poll after any restart."
					>
						bookmark
					</Term>{" "}
					rides the tip.
				</p>
			</Specimen>

			<Specimen
				id="A10"
				name={
					<>
						<code>&lt;SpecSheet&gt;</code>: the facts about one thing
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> a post references a surface and the reader needs its
						vitals without leaving. Adopts the console data-table voice: mono,
						hairline rows, uppercase keys. Static on purpose.
					</>
				}
			>
				<SpecSheet
					rows={[
						{ k: "endpoint", v: "GET /v1/index/contract-calls" },
						{ k: "auth", v: "key optional", dim: "(keyless = recent window)" },
						{ k: "pagination", v: "cursor keyset, limit ≤ 200" },
						{ k: "cursor format", v: "block_height:event_index" },
						{
							k: "ordering",
							v: "ascending, total",
							dim: "(one order per feed)",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="A11"
				name={
					<>
						<code>&lt;SourceQuote&gt;</code>: the primary source, cited
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> the story layer quotes a spec, RFC, or source file.
						The citation names the exact artifact; paraphrase never wears quote
						marks.
					</>
				}
			>
				<SourceQuote source="ConsumerSink contract, rollback · sdk/src/sinks/types.ts">
					Roll the projection back to the fork: delete everything at or above
					the fork point and commit the rewound cursor in the same transaction.
					Deleting without the rewound cursor is the classic silent-gap bug.
				</SourceQuote>
			</Specimen>

			<Cat
				code="B"
				title="Diagrams"
				note="Spatial explanations: positions, flows, sequences. The tier where label collision management earns its keep: every diagram must survive its own extreme states."
			/>

			<Specimen
				id="B1"
				name={
					<>
						<code>&lt;PositionTrack&gt;</code>: positions on one axis
					</>
				}
				tier="collision-fixed"
				use={
					<>
						<b>Collision rule:</b> markers within 8% of each other merge their
						flags into one combined label and collapse duplicate values. Values
						sit on their own tier below the rail; flags stagger when neighboring
						groups sit close.
					</>
				}
			>
				<PositionTrack
					states={[
						{
							label: "split (quiet feed)",
							markers: [
								{
									id: "a",
									label: "last_delivered",
									value: "8,637,064",
									role: "a",
									pos: 12,
								},
								{ id: "b", label: "scanned", role: "b", pos: 88 },
								{
									id: "t",
									label: "tip",
									value: "8,676,502",
									role: "muted",
									kind: "tick",
									pos: 88.5,
								},
							],
						},
						{
							label: "converged (busy feed)",
							markers: [
								{
									id: "a",
									label: "last_delivered",
									value: "8,676,502",
									role: "a",
									pos: 84,
								},
								{ id: "b", label: "scanned", role: "b", pos: 87 },
								{
									id: "t",
									label: "tip",
									role: "muted",
									kind: "tick",
									pos: 88,
								},
							],
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="B2"
				name={
					<>
						<code>&lt;FlowLoop&gt;</code>: request / response with cost counters
					</>
				}
				tier="css motion"
				use={
					<>
						<b>Use when</b> the mechanism is a loop between two parties. The
						counter row is the argument; the shuttle is atmosphere (and pauses
						under reduced-motion).
					</>
				}
			>
				<FlowLoop
					left={{ kicker: "consumer", body: "GET …?cursor=8637064:1" }}
					right={{ kicker: "catalog", body: "{ rows: [], next: null }" }}
					counter={{ label: "polls", intervalMs: 2200 }}
					extras={[{ label: "blocks read client-side", value: "0" }]}
				/>
			</Specimen>

			<Specimen
				id="B3"
				name={
					<>
						<code>&lt;Timeline&gt;</code>: ordered events on a time axis
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> order carries the information. Shares B1&rsquo;s
						flag collision rule. Major ticks in role colors; minor ticks stay
						faint.
					</>
				}
			>
				<Timeline
					ariaLabel="Timeline: block 100, the last sale at 102, a fork detected, and the tip at 103."
					events={[
						{ pos: 8, value: "block 100" },
						{
							pos: 34,
							label: "last sale",
							value: "102",
							role: "a",
							major: true,
						},
						{ pos: 62, value: "fork detected" },
						{ pos: 90, label: "tip", value: "103", major: true },
					]}
				/>
			</Specimen>

			<Specimen
				id="B4"
				name={
					<>
						<code>&lt;Lifecycle&gt;</code>: a state machine you can walk
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a system has named states and the edges are the
						story. Active state carries the accent (the flow-diagram node
						grammar); the caption narrates each transition in words.
					</>
				}
			>
				<Lifecycle
					viewBox="0 0 620 130"
					ariaLabel="Consumer lifecycle: init, then tailing, with a reorg edge to rolled-back and a re-read edge returning to tailing."
					nodes={[
						{ id: "init", label: "init", x: 20, y: 45, w: 110, h: 40 },
						{ id: "tail", label: "tailing", x: 240, y: 45, w: 120, h: 40 },
						{ id: "roll", label: "rolled_back", x: 480, y: 45, w: 120, h: 40 },
					]}
					edges={[
						{ id: "e1", d: "M130 65 H 240" },
						{
							id: "e2",
							d: "M360 58 C 420 30, 460 30, 500 50",
							label: "reorg detected",
							labelX: 435,
							labelY: 30,
						},
						{
							id: "e3",
							d: "M500 88 C 460 112, 400 112, 360 74",
							label: "re-read from fork",
							labelX: 432,
							labelY: 118,
						},
					]}
					mainPath={[
						{
							node: "init",
							caption:
								"loadCursor runs once: checkpoint storage created, rollback preconditions checked.",
						},
						{
							node: "tail",
							edge: "e1",
							caption:
								"Tailing: one indexed poll per interval; rows and cursor commit together when anything lands.",
						},
					]}
					idleCaption="Still tailing. Inject a reorg to see the other edge."
					events={[
						{
							label: "inject reorg",
							step: {
								node: "roll",
								edge: "e2",
								caption:
									"Fork detected below the cursor: delete at or above the fork and rewind the receipt, one transaction.",
							},
							resume: {
								node: "tail",
								edge: "e3",
								caption:
									"Re-read from the fork foot: the new canonical rows land; the same reorg re-reported is ignored.",
							},
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="B5"
				name={
					<>
						<code>&lt;PipelineFlow&gt;</code>: multi-stage systems, flowing
					</>
				}
				tier="css motion"
				use={
					<>
						<b>Use when</b> showing where a post&rsquo;s subject sits in the
						system. Adopts the service-flow node grammar: Chrome default, tinted
						data stage, ONE filled accent node for the product surface. Edge
						dashes march (still under reduced-motion).
					</>
				}
			>
				<PipelineFlow
					ariaLabel="Pipeline: chain node feeds the decoder, which feeds the index, which serves your consumer. The index is the highlighted product surface."
					stages={[
						{ label: "stacks node", sub: "raw blocks" },
						{ label: "decoder", sub: "events, calls", kind: "data" },
						{ label: "index", sub: "the catalog", kind: "api" },
						{ label: "your consumer", sub: "one poll, one seek", w: 136 },
					]}
				/>
			</Specimen>

			<Specimen
				id="B6"
				name={
					<>
						<code>&lt;SequenceDiagram&gt;</code>: who says what, when
					</>
				}
				tier="css hover"
				use={
					<>
						<b>Use when</b> three or more parties exchange messages and ORDER
						matters. Hover or focus a message: it and both endpoints light.
						Returns are dashed. Keep to ≤6 messages; past that it&rsquo;s two
						diagrams.
					</>
				}
			>
				<SequenceDiagram
					ariaLabel="Sequence: consumer polls the API, the API returns rows, the consumer commits rows and cursor to Postgres in one transaction."
					actors={["consumer", "api", "postgres"]}
					messages={[
						{ from: 0, to: 1, label: "GET ?cursor=8637064:1" },
						{ from: 1, to: 0, label: "rows + next_cursor", ret: true },
						{ from: 0, to: 2, label: "BEGIN · rows · cursor · COMMIT" },
						{ from: 2, to: 0, label: "ok: the receipt moved", ret: true },
					]}
				/>
			</Specimen>

			<Specimen
				id="B7"
				name={
					<>
						<code>&lt;LayerStack&gt;</code>: where you are in the stack
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> orienting a reader before a deep dive. A layer lifts
						sideways on hover/tap and narrates itself. Order is physical: the
						chain at the bottom, the reader&rsquo;s code on top.
					</>
				}
			>
				<LayerStack
					layers={[
						{
							label: "your app",
							sub: "consume loops · sinks",
							note: "Your indexer, dashboard, or agent. Talks to one API; never touches a node.",
						},
						{
							label: "secondlayer",
							sub: "index · streams · subgraphs",
							kind: "api",
							note: "The product surface: decoded, indexed, served. The one filled node, per the flow-diagram grammar.",
						},
						{
							label: "decode layer",
							sub: "events · calls · prints",
							kind: "data",
							note: "Decode and shape: raw blocks become typed events, calls, and prints.",
						},
						{
							label: "bitcoin + stacks",
							sub: "blocks · finality",
							note: "The chains themselves. Finality flows up from here; reorgs start here too.",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="B8"
				name={
					<>
						<code>&lt;TreeWalk&gt;</code>: the log-time seek, performed
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> &ldquo;logarithmic&rdquo; needs to be felt, not
						asserted. Three comparisons reach any of millions of keys; the
						counter says so. Path lights stepwise (instant under
						reduced-motion).
					</>
				}
			>
				<TreeWalk
					viewBox="0 0 620 168"
					ariaLabel="A three-level index tree. Choosing a key highlights the three-node path from root to leaf."
					nodes={[
						{
							id: "root",
							x: 250,
							y: 24,
							w: 120,
							h: 28,
							label: "< 8,650,000 ?",
						},
						{ id: "l", x: 100, y: 88, w: 120, h: 28, label: "< 8,600,000 ?" },
						{ id: "r", x: 400, y: 88, w: 120, h: 28, label: "< 8,670,000 ?" },
						{ id: "l0", x: 30, y: 140, w: 110, h: 24, label: "…8,599,991" },
						{ id: "l1", x: 180, y: 140, w: 110, h: 24, label: "8,637,064…" },
						{ id: "l2", x: 330, y: 140, w: 110, h: 24, label: "8,652,110…" },
						{ id: "l3", x: 480, y: 140, w: 110, h: 24, label: "8,676,502…" },
					]}
					edges={[
						{ id: "e00", x1: 310, y1: 52, x2: 160, y2: 84 },
						{ id: "e01", x1: 310, y1: 52, x2: 460, y2: 84 },
						{ id: "e10", x1: 160, y1: 116, x2: 85, y2: 140 },
						{ id: "e11", x1: 160, y1: 116, x2: 235, y2: 140 },
						{ id: "e12", x1: 460, y1: 116, x2: 385, y2: 140 },
						{ id: "e13", x1: 460, y1: 116, x2: 535, y2: 140 },
					]}
					seeks={[
						{
							label: "seek 8,637,064",
							path: ["root", "e00", "l", "e11", "l1"],
						},
						{
							label: "seek 8,676,502",
							path: ["root", "e01", "r", "e13", "l3"],
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="B9"
				name={
					<>
						<code>&lt;BeforeAfter&gt;</code>: one geometry, two states
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> the same scene changes state. One geometry, toggled:
						the orphaned range (tinted) empties and the receipt rewinds below
						the fork. Nothing redraws; only the deltas move, so the eye tracks
						WHAT changed.
					</>
				}
			>
				<BeforeAfter
					states={[
						{
							label: "before rollback",
							zone: { left: 62, width: 26, visible: true },
							markers: [
								{
									id: "cursor",
									flag: "receipt",
									tone: "a",
									pos: 88,
									value: "103:0",
								},
								{
									id: "fork",
									flag: "fork",
									tone: "alarm",
									kind: "tick",
									pos: 62,
									value: "102",
								},
							],
						},
						{
							label: "after rollback",
							zone: { left: 62, width: 26, visible: false },
							markers: [
								{
									id: "cursor",
									flag: "receipt",
									tone: "a",
									pos: 56,
									value: "101:2147483647",
								},
								{
									id: "fork",
									flag: "fork",
									tone: "alarm",
									kind: "tick",
									pos: 62,
									value: "102",
								},
							],
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="B10"
				name={
					<>
						<code>&lt;StateRow&gt;</code>: a status, advancing
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a linear status progression needs to be operated to
						be understood. House badge colors by state; past states dim, the
						current one fills. Arrow keys work; wraps around.
					</>
				}
			>
				<StateRow
					ariaLabel="Transaction status progression. Click or press arrow keys to advance."
					states={[
						{
							label: "pending",
							tone: "pending",
							caption: "pending: in the mempool, nothing durable yet",
						},
						{
							label: "confirmed",
							tone: "confirmed",
							caption: "confirmed: in a canonical block, can still reorg",
						},
						{
							label: "finalized",
							tone: "final",
							caption:
								"finalized: below the finalized height, never reorgs; finalizedOnly consumers read from here",
						},
					]}
				/>
			</Specimen>

			<Cat
				code="C"
				title="Charts"
				note="Full dataviz method: validated palette, thin marks, recessive grid, always a hover layer, direct labels with collision resolution."
			/>

			<Specimen
				id="C1"
				name={
					<>
						<code>&lt;LineChart&gt;</code>: change over time, ≤4 series
					</>
				}
				tier="collision-fixed"
				use={
					<>
						<b>Collision rules:</b> end labels resolve vertical collisions
						(nudged ≥14px apart, clamped inside the plot); the tooltip clamps to
						both container edges instead of clipping; threshold labels claim
						their own y-band before direct labels place.
					</>
				}
			>
				<LineChart
					ariaLabel="Event age hovers near 39,300 and climbs; backlog stays at zero. Dashed alert threshold at 1,000."
					yMax={42000}
					yTicks={[
						{ v: 0, label: "0k" },
						{ v: 10000, label: "10k" },
						{ v: 20000, label: "20k" },
						{ v: 30000, label: "30k" },
						{ v: 40000, label: "40k" },
					]}
					xTicks={[
						{ v: 9, label: "9:00" },
						{ v: 12, label: "12:00" },
						{ v: 15, label: "15:00" },
						{ v: 18, label: "18:00" },
					]}
					threshold={{ y: 1000, label: "alert threshold" }}
					series={[
						{
							id: "age",
							role: "b",
							label: "event age",
							points: C1_POINTS.map((p) => ({ x: p.t, y: p.b })),
						},
						{
							id: "backlog",
							role: "a",
							label: "backlog",
							points: C1_POINTS.map((p) => ({ x: p.t, y: p.a })),
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="C2"
				name={
					<>
						<code>&lt;BarChart&gt;</code>: magnitudes, compared
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> comparing magnitudes across a handful of entities.
						Thin marks, 4px rounded data-end only, every bar direct-labeled. One
						hue: identity lives in the axis, not the palette.
					</>
				}
			>
				<BarChart
					ariaLabel="Rows delivered per feed: stx transfers highest at 48 thousand, then ft transfers, prints, contract calls, and nft transfers lowest."
					bars={[
						{ label: "stx_transfer", value: 48200, display: "48,200" },
						{ label: "ft_transfer", value: 31400, display: "31,400" },
						{ label: "print", value: 18900, display: "18,900" },
						{ label: "contract_call", value: 9300, display: "9,300" },
						{ label: "nft_transfer", value: 4100, display: "4,100" },
					]}
				/>
			</Specimen>

			<Specimen
				id="C3"
				name={
					<>
						<code>&lt;SmallMultiples&gt;</code>: same measure, many entities
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> the comparison is across entities, not within one
						chart. Shared scales always (a per-panel scale is a lie); one
						measure, panel titles in mono; endpoint dots instead of a legend.
					</>
				}
			>
				<SmallMultiples
					ariaLabel="Three small charts of backlog over one day, shared scale: a backfilling consumer falls to zero, a caught-up one stays flat at zero, a wedged one climbs."
					yMax={40}
					panels={[
						{
							title: "backfilling",
							points: Array.from({ length: 21 }, (_, i) => 40 - (i / 20) * 38),
						},
						{
							title: "caught up",
							points: Array.from({ length: 21 }, () => 2),
						},
						{
							title: "wedged",
							points: Array.from({ length: 21 }, (_, i) => 4 + (i / 20) * 30),
							tone: "alarm",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="C4"
				name={
					<>
						<code>&lt;CellStrip&gt;</code>: density along an axis
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> showing where things are along a range (matching
						blocks, gaps, occupancy). 2px surface gaps between cells; hits in
						the role color, never a new hue.
					</>
				}
			>
				<CellStrip
					cells={56}
					hits={[3, 4, 9, 17, 18, 19, 33, 48]}
					ariaLabel="Blocks along the chain; filled cells are blocks containing matching events."
				/>
			</Specimen>

			<Specimen
				id="C5"
				name={
					<>
						<code>&lt;Distribution&gt;</code>: the spread, not the average
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> an average would hide the story. Percentile markers
						are dashed ink (not a series color) and direct-labeled; per-bin
						hover gives the exact count.
					</>
				}
			>
				<Distribution
					ariaLabel="Histogram of poll latency in milliseconds, most mass between 8 and 30 with a long tail. p50 at 14 milliseconds and p95 at 52 are marked."
					bins={[2, 9, 21, 34, 28, 19, 12, 8, 5, 4, 3, 2, 2, 1]}
					binWidth={5}
					unit="ms"
					countUnit="polls"
					percentiles={[
						{ label: "p50 14ms", x: 14 },
						{ label: "p95 52ms", x: 52 },
					]}
					xTicks={[0, 20, 40, 60]}
				/>
			</Specimen>

			<Specimen
				id="C6"
				name={
					<>
						<code>&lt;DeltaBars&gt;</code>: before and after, paired
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a change&rsquo;s size is the argument. Pairs share a
						baseline; the role colors carry which regime is which, consistently
						with every other figure in the post.
					</>
				}
			>
				<DeltaBars
					ariaLabel="Paired bars per restart scenario: a client-side walker reads thousands of blocks; the catalog answers each in one seek."
					legend={["walker (reads blocks)", "catalog (one seek)"]}
					max={60500}
					groups={[
						{
							label: "restart after 1h",
							b: { value: 360, tooltip: "walker reads 360 blocks" },
							a: { value: 600, tooltip: "catalog: 1 seek", display: "1 seek" },
						},
						{
							label: "after 1 day",
							b: { value: 8600, tooltip: "walker reads 8,600 blocks" },
							a: { value: 600, tooltip: "catalog: 1 seek", display: "1 seek" },
						},
						{
							label: "after 1 week",
							b: { value: 60500, tooltip: "walker reads 60,500 blocks" },
							a: { value: 600, tooltip: "catalog: 1 seek", display: "1 seek" },
						},
						{
							label: "after 40k blocks",
							b: { value: 40000, tooltip: "walker reads 40,000 blocks" },
							a: { value: 600, tooltip: "catalog: 1 seek", display: "1 seek" },
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="C7"
				name={
					<>
						<code>&lt;InlineSpark&gt;</code>: a trend inside the sentence
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> a sentence mentions a trend and a full chart would
						be ceremony. Word-scale, no axes, endpoint dot, aria-label carrying
						the reading. Never for values a reader must compare precisely.
					</>
				}
			>
				<p className="fig-prose">
					Backlog fell through the backfill{" "}
					<InlineSpark
						points={[10, 6, 3, 1, 0.5, 0.5]}
						tone="a"
						title="Sparkline: backlog falling steeply to zero"
					/>{" "}
					and held at zero, while event age{" "}
					<InlineSpark
						points={[0, 1, 1.5, 2.5, 3.5]}
						tone="b"
						title="Sparkline: event age climbing slowly"
					/>{" "}
					kept climbing.
				</p>
			</Specimen>

			<Specimen
				id="C8"
				name={
					<>
						<code>&lt;HeatCalendar&gt;</code>: activity across days
					</>
				}
				tier="no js"
				use={
					<>
						<b>Use when</b> WHEN things happened matters more than how many.
						Sequential single-hue ramp, lightness monotonic, 2px gaps; the empty
						recent weeks ARE the story for a dormant contract.
					</>
				}
			>
				<HeatCalendar
					weeks={C8_WEEKS}
					unit="sales"
					ariaLabel="Eight weeks of contract activity by day. Dense early weeks fade to empty recent weeks: the quiet contract."
				/>
			</Specimen>

			<Cat
				code="D"
				title="Explorers"
				note="A parameter the reader can move. Highest cost to build and to read: at most one per post, placed at the section it proves."
			/>

			<Specimen
				id="D1"
				name={
					<>
						<code>&lt;ParamExplorer&gt;</code>: slide a parameter, watch the
						regime change
					</>
				}
				tier="collision-fixed"
				use={
					<>
						<b>Collision rule:</b> when the two pointers come within 10% they
						collapse into one merged pointer with a combined label. The readout
						sentence is part of the figure: it states the regime in words at
						every slider position.
					</>
				}
			>
				<SelectivityExplorer />
			</Specimen>

			<Specimen
				id="D2"
				name={
					<>
						<code>&lt;ScenarioToggle&gt;</code>: two named worlds
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> two named scenarios share one figure shape.
						Segmented buttons switch which world renders; panels are plain
						children, so any static figure can be toggled.
					</>
				}
			>
				<ScenarioToggle
					labels={["quiet contract", "busy contract"]}
					panels={[
						<CellStrip
							key="quiet"
							cells={56}
							hits={[4]}
							ariaLabel="A quiet contract: one matching block near the start of the range."
						/>,
						<CellStrip
							key="busy"
							cells={56}
							hits={Array.from({ length: 28 }, (_, i) => i * 2)}
							ariaLabel="A busy contract: every other block matches."
						/>,
					]}
				/>
			</Specimen>

			<Specimen
				id="D3"
				name={
					<>
						<code>&lt;StepThrough&gt;</code>: an algorithm, one move at a time
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> the reader must hold intermediate state in their
						head. Arrow keys work; the final step rewinds the story to the crash
						case, which is the payoff.
					</>
				}
			>
				<StepThrough
					lines={[
						"BEGIN",
						"INSERT rows (the handler's writes)",
						"UPSERT cursor '8637064:1'",
						"COMMIT",
						"-- crash here instead? --",
					]}
					steps={[
						{
							now: 0,
							caption:
								"Open the transaction. Nothing is visible to anyone else yet.",
						},
						{
							now: 1,
							caption:
								"The handler's inserts land inside the open transaction.",
						},
						{
							now: 2,
							caption:
								"The receipt joins them: same transaction, by construction.",
						},
						{
							now: 3,
							caption:
								"Commit: rows and cursor become durable together. This is invariant #4.",
						},
						{
							now: 4,
							dead: [3],
							caption:
								"The crash case: die anywhere before COMMIT and NOTHING landed. The batch is simply re-read; there is no in-between.",
						},
					]}
				/>
			</Specimen>

			<Specimen
				id="D4"
				name={
					<>
						<code>&lt;Predict&gt;</code>: commit to a guess first
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> a post&rsquo;s aha benefits from the reader being
						wrong first. The guess commits before the reveal; wrong picks stay
						visible so the correction lands. One per post, at the turn.
					</>
				}
			>
				<Predict
					question={
						<>
							A consumer is caught up on a quiet contract. You restart it. What
							does <code>resuming from</code> print?
						</>
					}
					options={[
						{ label: "the current chain tip" },
						{ label: "the same cursor as before the restart", right: true },
						{ label: "null, until the first delivered row" },
					]}
					reveal={
						<>
							<b>The same cursor.</b> The checkpoint is a receipt for the last
							delivered row, and nothing was delivered while the contract was
							quiet. The first poll re-verifies the empty range in one seek; the
							scan position is recomputed, not stored.
						</>
					}
				/>
			</Specimen>

			<Specimen
				id="D5"
				name={
					<>
						<code>&lt;CrossHighlight&gt;</code>: input and output, wired
						together
					</>
				}
				tier="interactive"
				use={
					<>
						<b>Use when</b> the reader should see WHICH input produced WHICH
						output. Hover or focus either side; its counterpart lights. Unpaired
						fields staying dim is information too: they came along for free.
					</>
				}
			>
				<CrossHighlight
					chips={[
						{
							pair: "p1",
							kicker: "filter",
							label: "contract_id = SP…marketplace-v4",
						},
						{
							pair: "p2",
							kicker: "filter",
							label: "function_name = purchase-asset",
						},
						{ pair: "p3", kicker: "filter", label: "status = success" },
					]}
					segments={[
						'{\n  "contract_id": ',
						{ pair: "p1", text: '"SP…marketplace-v4"' },
						',\n  "function_name": ',
						{ pair: "p2", text: '"purchase-asset"' },
						',\n  "status": ',
						{ pair: "p3", text: '"success"' },
						',\n  "tx_id": "0x9c41…",\n  "block_height": 8637064\n}',
					]}
				/>
			</Specimen>

			<Specimen
				id="D7"
				name={
					<>
						<code>&lt;CopyBlock&gt;</code>: hand it to your agent
					</>
				}
				tier="adopts production"
				use={
					<>
						<b>Rule:</b> adopts the production agent-prompt block; one
						implementation, two mounts, never forked. (D6{" "}
						<code>&lt;MiniSandbox&gt;</code> stays a reserved slot: the dataset
						sandbox it adopted left production, so it returns when a post needs
						a live request cell.)
					</>
				}
			>
				<CopyBlock
					title="Build a checkpointed indexer"
					code={`Read /docs/custom-sinks and implement a ConsumerSink for my store.
Hold the 13 invariants; start from the bun:sqlite reference sink.
Run the conformance kit (attachSinkConformance) before wiring it in.`}
				/>
			</Specimen>
		</main>
	);
}
