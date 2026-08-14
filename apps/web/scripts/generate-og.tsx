/**
 * Generates the per-route OG share cards in public/og/*.png.
 *
 * Run from apps/web:  bun scripts/generate-og.tsx
 *
 * Each card is a 1200×630 "quiet install page" frame (DESIGN.md, Grok Build
 * school): ink logo + wordmark, a mono product eyebrow, a two-beat
 * Sora headline, and a dimmed product artifact in Fira Code creeping
 * in from the right. Data-driven, so a copy change is one edit + a re-run.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { POSTS } from "../src/lib/writing";

const FONT_DIR = join(process.cwd(), "src/assets/og-fonts");
const OUT_DIR = join(process.cwd(), "public/og");

const [sora, soraMed, fira, firaMed] = await Promise.all([
	readFile(join(FONT_DIR, "Sora-SemiBold.ttf")),
	readFile(join(FONT_DIR, "Sora-Medium.woff")),
	readFile(join(FONT_DIR, "FiraCode-Regular.ttf")),
	readFile(join(FONT_DIR, "FiraCode-Medium.ttf")),
]);

const SIZE = { width: 1200, height: 630 };

// palette — DESIGN.md tokens (quiet install page)
const PAPER = "#ffffff";
const INK = "#0a0a0a";
const MUTED2 = "#7d8187"; // headline second beat (the one picked gray)
const HAIR = "rgba(10,10,10,0.1)";
const ACCENT = "#ff5c0a"; // sunset
// artifact (dimmed, recedes behind the headline) — ink alpha ramp, monochrome
const BASE = "rgba(10,10,10,0.34)";
const STR = "rgba(10,10,10,0.42)";
const KW = "rgba(10,10,10,0.55)";
const DIM = "rgba(10,10,10,0.22)";
const CARD_BG = "rgba(248,246,242,0.85)";
const CARD_BORDER = "rgba(10,10,10,0.08)";
const CARD_SHADOW = "0 16px 36px rgba(10,10,10,0.05)";

// Non-breaking space: satori collapses regular spaces at span boundaries, so
// inter-token whitespace ("await streams") would vanish. Fira Code is
// monospace, so nbsp keeps the same advance width.
const NB = " ";

// A line of monospace code/data: tokens are [text, color]; indent is preserved
// with a transparent leading span (Fira Code is monospace, so it aligns).
function Line({
	indent = 0,
	tokens,
}: {
	indent?: number;
	tokens: [string, string][];
}) {
	return (
		<div style={{ display: "flex", fontFamily: "Fira Code", lineHeight: 1.6 }}>
			{indent > 0 ? (
				<span style={{ color: "transparent" }}>{NB.repeat(indent)}</span>
			) : null}
			{tokens.map((t, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static render
				<span key={i} style={{ color: t[1] }}>
					{t[0].replace(/ /g, NB)}
				</span>
			))}
		</div>
	);
}

function Card({
	children,
	style,
}: {
	children: React.ReactNode;
	style?: React.CSSProperties;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				background: CARD_BG,
				border: `1px solid ${CARD_BORDER}`,
				borderRadius: 12,
				boxShadow: CARD_SHADOW,
				padding: "22px 28px",
				fontSize: 26,
				...style,
			}}
		>
			{children}
		</div>
	);
}

// ── artifacts ────────────────────────────────────────────────────────────────

function ArtStreams() {
	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
			}}
		>
			<Card style={{ position: "absolute", top: 130, left: 815, width: 700 }}>
				<Line
					tokens={[
						["await ", BASE],
						["streams.events.", BASE],
						["consume", KW],
						["({", BASE],
					]}
				/>
				<Line indent={2} tokens={[["fromCursor: lastCheckpoint,", BASE]]} />
				<Line
					indent={2}
					tokens={[
						["onBatch: ", BASE],
						["async", KW],
						[" (events, { cursor }) => {", BASE],
					]}
				/>
				<Line
					indent={4}
					tokens={[
						["for", KW],
						[" (const e of events) ", BASE],
						["await ", BASE],
						["handle", KW],
						["(e);", BASE],
					]}
				/>
				<Line indent={2} tokens={[["},", BASE]]} />
				<Line
					indent={2}
					tokens={[
						["onReorg: async (reorg) => ", BASE],
						["rollbackAbove", KW],
						["(reorg.fo…", BASE],
					]}
				/>
				<Line tokens={[["});", BASE]]} />
			</Card>
			<Card style={{ position: "absolute", top: 492, left: 895, width: 640 }}>
				<Line tokens={[["{", BASE]]} />
				<Line
					indent={2}
					tokens={[
						['"block_height"', STR],
						[": 3412887,", BASE],
					]}
				/>
				<Line
					indent={2}
					tokens={[
						['"tx_id"', STR],
						[': "0x9f3c41…",', BASE],
					]}
				/>
				<Line
					indent={2}
					tokens={[
						['"event_index"', STR],
						[": 3,", BASE],
					]}
				/>
				<Line
					indent={2}
					tokens={[
						['"type"', STR],
						[': "contract_event",', BASE],
					]}
				/>
				<Line
					indent={2}
					tokens={[
						['"raw_value"', STR],
						[': "0x0c0000000308616…', BASE],
					]}
				/>
			</Card>
		</div>
	);
}

function ArtIndex() {
	const rows: [string, string, [string, string][]][] = [
		["#3,412,884", "contract_call", [["pox-4 · stack…", BASE]]],
		["#3,412,885", "ft_transfer", [["sbtc-toke…", BASE]]],
		[
			"#3,412,886",
			"print_event",
			[
				['"sale"', KW],
				[" · marketpla…", BASE],
			],
		],
		["#3,412,887", "stx_transfer", [["125.5 STX", BASE]]],
		["#3,412,887", "nft_transfer", [["bns · name-tran…", BASE]]],
	];
	return (
		<div
			style={{
				position: "absolute",
				top: 150,
				left: 838,
				display: "flex",
				flexDirection: "column",
				width: 800,
			}}
		>
			{rows.map((r, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: static render
					key={i}
					style={{
						display: "flex",
						alignItems: "center",
						height: 62,
						borderTop: i === 0 ? "none" : `1px solid ${HAIR}`,
						fontFamily: "Fira Code",
						fontSize: 27,
					}}
				>
					<span style={{ color: DIM, width: 200 }}>{r[0]}</span>
					<span style={{ color: BASE, width: 250 }}>{r[1]}</span>
					<div style={{ display: "flex" }}>
						{r[2].map((t, j) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static render
							<span key={j} style={{ color: t[1] }}>
								{t[0]}
							</span>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/** Subscriptions: the receiver above, the delivery log (with a fork) below. */
function ArtSubscriptions() {
	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
			}}
		>
			<Card style={{ position: "absolute", top: 126, left: 815, width: 720 }}>
				<Line
					tokens={[
						["const", KW],
						[" d = ", BASE],
						["decodeChainWebhook", KW],
						["(raw);", BASE],
					]}
				/>
				<Line
					tokens={[
						["if", KW],
						[' ("trigger" ', BASE],
						["in", KW],
						[" d.data) {", BASE],
					]}
				/>
				<Line
					indent={2}
					tokens={[
						["switch", KW],
						[" (d.data.trigger) {", BASE],
					]}
				/>
				<Line
					indent={4}
					tokens={[
						["case", KW],
						[' "sbtc_deposit"', STR],
						[": ", BASE],
						["credit", KW],
						["(d.data.event);", BASE],
					]}
				/>
				<Line indent={2} tokens={[["}", BASE]]} />
				<Line
					tokens={[
						["} ", BASE],
						["else", KW],
						[" ", BASE],
						["undo", KW],
						["(d.data.orphaned);", BASE],
					]}
				/>
			</Card>
			<Card style={{ position: "absolute", top: 470, left: 880, width: 660 }}>
				<Line
					tokens={[
						["200", ACCENT],
						["  chain.sbtc_deposit.apply", BASE],
					]}
				/>
				<Line
					tokens={[
						["200", ACCENT],
						["  chain.ft_transfer.apply", BASE],
					]}
				/>
				{/* ASCII only — Fira Code has no ↺, and a miss sends satori off to
				    fetch a dynamic font that isn't reachable from the build. */}
				<Line
					tokens={[
						["<<", ACCENT],
						["   chain.reorg.rollback", BASE],
					]}
				/>
				<Line
					tokens={[
						['      "fork_point_height"', STR],
						[": 8249711", DIM],
					]}
				/>
			</Card>
		</div>
	);
}

function ArtSubgraphs() {
	return (
		<div
			style={{
				position: "absolute",
				top: 128,
				left: 740,
				right: 0,
				bottom: 0,
				display: "flex",
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", fontSize: 27 }}>
				<Line
					tokens={[
						["export default ", BASE],
						["defineSubgraph", KW],
						["({", BASE],
					]}
				/>
				<Line
					indent={2}
					tokens={[
						["name: ", BASE],
						['"stx-transfers",', STR],
					]}
				/>
				<Line indent={2} tokens={[["sources: {", BASE]]} />
				<Line
					indent={4}
					tokens={[
						["transfer: { type: ", BASE],
						['"stx_transfer"', STR],
						[" },", BASE],
					]}
				/>
				<Line indent={2} tokens={[["},", BASE]]} />
				<Line indent={2} tokens={[["schema: {", BASE]]} />
				<Line indent={4} tokens={[["transfers: {", BASE]]} />
				<Line indent={6} tokens={[["columns: {", BASE]]} />
				<Line
					indent={8}
					tokens={[
						["sender: { type: ", BASE],
						['"principal"', STR],
						[", indexed: ", BASE],
						["true", KW],
						[" }", BASE],
					]}
				/>
				<Line
					indent={8}
					tokens={[
						["recipient: { type: ", BASE],
						['"principal"', STR],
						[", indexed: ", BASE],
						["tru…", KW],
					]}
				/>
				<Line
					indent={8}
					tokens={[
						["amount: { type: ", BASE],
						['"uint"', STR],
						[" },", BASE],
					]}
				/>
				<Line indent={6} tokens={[["},", DIM]]} />
				<Line indent={4} tokens={[["},", DIM]]} />
				<Line indent={2} tokens={[["},", DIM]]} />
				<Line indent={2} tokens={[["handlers: {", DIM]]} />
			</div>
		</div>
	);
}

function PlanCard({
	eyebrow,
	price,
	per,
	bullets,
	style,
	faded,
}: {
	eyebrow: string;
	price: string;
	per?: string;
	bullets: string[];
	style?: React.CSSProperties;
	faded?: boolean;
}) {
	const text = faded ? "rgba(10,10,10,0.4)" : "rgba(10,10,10,0.62)";
	const ink = faded ? "rgba(10,10,10,0.62)" : INK;
	return (
		<Card
			style={{
				position: "absolute",
				width: 380,
				padding: "28px 34px",
				gap: 4,
				...style,
			}}
		>
			<span
				style={{
					fontFamily: "Sora",
					fontSize: 17,
					letterSpacing: 1.6,
					color: "rgba(10,10,10,0.42)",
				}}
			>
				{eyebrow}
			</span>
			<div style={{ display: "flex", alignItems: "flex-end" }}>
				<span style={{ fontFamily: "Sora", fontSize: 62, color: ink }}>
					{price}
				</span>
				{per ? (
					<span
						style={{
							fontFamily: "Sora",
							fontSize: 26,
							color: text,
							paddingBottom: 12,
						}}
					>
						{per}
					</span>
				) : null}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 10,
					marginTop: 10,
				}}
			>
				{bullets.map((b, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: static render
						key={i}
						style={{
							display: "flex",
							fontFamily: "Sora",
							fontSize: 23,
							color: text,
						}}
					>
						{`—  ${b}`}
					</span>
				))}
			</div>
		</Card>
	);
}

function ArtPricing() {
	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
			}}
		>
			<PlanCard
				eyebrow="SELF-HOST · MIT"
				price="$0"
				bullets={["docker compose up", "MIT-licensed", "Single-tenant"]}
				style={{ top: 148, left: 730 }}
			/>
			<PlanCard
				eyebrow="ARCHIVE CREDITS"
				price="$10–$100"
				bullets={["R2 restore", "R2 backfill", "Prepaid cap"]}
				faded
				style={{ top: 372, left: 1010 }}
			/>
		</div>
	);
}

function ArtHome() {
	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
			}}
		>
			<Card
				style={{
					position: "absolute",
					top: 130,
					left: 730,
					width: 820,
					padding: "0 28px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						height: 64,
						fontFamily: "Fira Code",
						fontSize: 27,
					}}
				>
					<span style={{ color: DIM, width: 200 }}>#3,412,886</span>
					<span style={{ color: BASE, width: 250 }}>ft_transfer</span>
					<span style={{ color: BASE }}>sbtc-token</span>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						height: 64,
						borderTop: `1px solid ${HAIR}`,
						fontFamily: "Fira Code",
						fontSize: 27,
					}}
				>
					<span style={{ color: DIM, width: 200 }}>#3,412,887</span>
					<span style={{ color: BASE, width: 250 }}>print_event</span>
					<span style={{ color: KW }}>"sale"</span>
				</div>
			</Card>
			<Card
				style={{
					position: "absolute",
					top: 312,
					left: 870,
					width: 700,
					fontSize: 27,
				}}
			>
				<Line
					tokens={[
						["defineSubgraph", KW],
						["({", BASE],
					]}
				/>
				<Line
					indent={2}
					tokens={[
						["name: ", BASE],
						['"stx-transfers",', STR],
					]}
				/>
				<Line indent={2} tokens={[["schema: { transfers: { … } },", BASE]]} />
				<Line indent={2} tokens={[["handlers: { … },", BASE]]} />
				<Line tokens={[["});", BASE]]} />
			</Card>
			<div
				style={{
					position: "absolute",
					top: 596,
					left: 1010,
					display: "flex",
					fontFamily: "Fira Code",
					fontSize: 24,
					color: DIM,
				}}
			>
				<span style={{ color: KW }}>await&nbsp;</span>
				<span>
					sl.index.events.consume({"{"} onBatch, onReorg {"}"})
				</span>
			</div>
		</div>
	);
}

// ── frame ────────────────────────────────────────────────────────────────────

type CardSpec = {
	file: string;
	eyebrow: string | null;
	line1: string;
	line2: string;
	mutedLine2: boolean;
	artifact: React.ReactNode;
};

// Size the headline so the longest beat fits the left column (~640px) before
// the artifact begins — shorter beats render bigger, longer ones step down.
function headlineSize(line1: string, line2: string) {
	const max = Math.max(line1.length, line2.length);
	return Math.max(62, Math.min(112, Math.floor(640 / (max * 0.48))));
}

function Frame(spec: CardSpec) {
	const size = headlineSize(spec.line1, spec.line2);
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: PAPER,
				padding: "60px 80px",
				fontFamily: "Sora",
			}}
		>
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					background:
						"radial-gradient(circle at 90% 6%, rgba(255,92,10,0.04), rgba(255,92,10,0) 42%)",
				}}
			/>

			{/* dimmed product artifact, behind the headline */}
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					display: "flex",
				}}
			>
				{spec.artifact}
			</div>

			{/* foreground: header + headline */}
			<div
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					borderBottom: `1px solid ${HAIR}`,
					paddingBottom: 22,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
					<svg
						viewBox="6 9 36 24"
						width="40"
						height="27"
						role="img"
						aria-label="secondlayer"
					>
						<polygon
							points="8,23 28,15 40,23 20,31"
							fill={INK}
							opacity={0.24}
						/>
						<polygon points="8,19 28,11 40,19 20,27" fill={INK} />
					</svg>
					<span
						style={{
							fontFamily: "Sora",
							fontWeight: 500,
							fontSize: 30,
							color: INK,
							letterSpacing: -0.5,
						}}
					>
						secondlayer
					</span>
				</div>
				{spec.eyebrow ? (
					<span
						style={{
							fontFamily: "Fira Code",
							fontSize: 20,
							letterSpacing: 2,
							color: "rgba(10,10,10,0.4)",
						}}
					>
						{spec.eyebrow}
					</span>
				) : null}
			</div>

			<div
				style={{
					position: "relative",
					flex: 1,
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					paddingBottom: 28,
				}}
			>
				<div style={{ display: "flex", flexDirection: "column" }}>
					<span
						style={{
							fontFamily: "Sora",
							fontWeight: 500,
							fontSize: size,
							color: INK,
							lineHeight: 1.04,
							letterSpacing: -size * 0.025,
						}}
					>
						{spec.line1}
					</span>
					<span
						style={{
							fontFamily: "Sora",
							fontWeight: 500,
							fontSize: size,
							color: spec.mutedLine2 ? MUTED2 : INK,
							lineHeight: 1.04,
							letterSpacing: -size * 0.025,
						}}
					>
						{spec.line2}
					</span>
				</div>
			</div>
		</div>
	);
}

const CARDS: CardSpec[] = [
	{
		file: "home.png",
		eyebrow: null,
		line1: "Your indexer.",
		line2: "Our decoders.",
		mutedLine2: false,
		artifact: <ArtHome />,
	},
	{
		file: "streams.png",
		eyebrow: "STREAMS",
		line1: "Every raw event.",
		line2: "No node required.",
		mutedLine2: true,
		artifact: <ArtStreams />,
	},
	{
		file: "index.png",
		eyebrow: "INDEX",
		line1: "We decode the chain.",
		line2: "You build the index.",
		mutedLine2: true,
		artifact: <ArtIndex />,
	},
	{
		file: "subgraphs.png",
		eyebrow: "SUBGRAPHS",
		line1: "You shape it.",
		line2: "We run it.",
		mutedLine2: true,
		artifact: <ArtSubgraphs />,
	},
	{
		file: "subscriptions.png",
		eyebrow: "SUBSCRIPTIONS",
		line1: "Only what matches.",
		line2: "On our infra or yours.",
		mutedLine2: true,
		artifact: <ArtSubscriptions />,
	},
	{
		file: "pricing.png",
		eyebrow: "PRICING",
		line1: "Runtime is free.",
		line2: "Archive work is metered.",
		mutedLine2: true,
		artifact: <ArtPricing />,
	},
];

const fonts = [
	{
		name: "Sora",
		data: soraMed,
		weight: 500 as const,
		style: "normal" as const,
	},
	{ name: "Sora", data: sora, weight: 600 as const, style: "normal" as const },
	{
		name: "Fira Code",
		data: fira,
		weight: 400 as const,
		style: "normal" as const,
	},
	{
		name: "Fira Code",
		data: firaMed,
		weight: 500 as const,
		style: "normal" as const,
	},
];

// ── writings cards ───────────────────────────────────────────────────────────
// Same field-notebook frame, but the headline is a full post title (satori
// wraps it), with a mono meta line underneath instead of a product artifact.

function WritingFrame({
	eyebrow,
	title,
	meta,
}: {
	eyebrow: string;
	title: string;
	meta: string;
}) {
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: PAPER,
				padding: "60px 80px",
				fontFamily: "Sora",
			}}
		>
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					background:
						"radial-gradient(circle at 90% 6%, rgba(255,92,10,0.04), rgba(255,92,10,0) 42%)",
				}}
			/>
			<div
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					borderBottom: `1px solid ${HAIR}`,
					paddingBottom: 22,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
					<svg
						viewBox="6 9 36 24"
						width="40"
						height="27"
						role="img"
						aria-label="secondlayer"
					>
						<polygon
							points="8,23 28,15 40,23 20,31"
							fill={INK}
							opacity={0.24}
						/>
						<polygon points="8,19 28,11 40,19 20,27" fill={INK} />
					</svg>
					<span
						style={{
							fontFamily: "Sora",
							fontWeight: 500,
							fontSize: 30,
							color: INK,
							letterSpacing: -0.5,
						}}
					>
						secondlayer
					</span>
				</div>
				<span
					style={{
						fontFamily: "Fira Code",
						fontSize: 20,
						letterSpacing: 3,
						color: ACCENT,
					}}
				>
					{eyebrow}
				</span>
			</div>
			<div
				style={{
					position: "relative",
					flex: 1,
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					gap: 30,
					paddingBottom: 28,
				}}
			>
				<span
					style={{
						fontFamily: "Sora",
						fontWeight: 500,
						fontSize: title.length > 44 ? 62 : 72,
						color: INK,
						lineHeight: 1.08,
						letterSpacing: -1.8,
						maxWidth: 1000,
					}}
				>
					{title}
				</span>
				<span
					style={{
						fontFamily: "Fira Code",
						fontSize: 22,
						color: "rgba(10,10,10,0.42)",
					}}
				>
					{meta.replace(/ /g, NB)}
				</span>
			</div>
		</div>
	);
}

const WRITING_CARDS: { file: string; frame: React.ReactElement }[] = [
	{
		file: "writing.png",
		frame: (
			<WritingFrame
				eyebrow="WRITINGS"
				title="Mechanism, explained."
				meta="long-form technical guides · secondlayer.tools/writing"
			/>
		),
	},
	// All posts, drafts included — flipping a draft live shouldn't need a re-run.
	...POSTS.map((post) => ({
		file: `writing-${post.slug}.png`,
		frame: (
			<WritingFrame
				eyebrow={`WRITINGS · ${String(post.number).padStart(2, "0")}`}
				title={post.title}
				meta={`${post.date} · ${post.readingTime} · ${post.tags.join(" · ")}`}
			/>
		),
	})),
];

for (const spec of CARDS) {
	const res = new ImageResponse(<Frame {...spec} />, { ...SIZE, fonts });
	const buf = Buffer.from(await res.arrayBuffer());
	await writeFile(join(OUT_DIR, spec.file), buf);
	console.log(`✓ ${spec.file}  (${buf.length.toLocaleString()} bytes)`);
}

for (const spec of WRITING_CARDS) {
	const res = new ImageResponse(spec.frame, { ...SIZE, fonts });
	const buf = Buffer.from(await res.arrayBuffer());
	await writeFile(join(OUT_DIR, spec.file), buf);
	console.log(`✓ ${spec.file}  (${buf.length.toLocaleString()} bytes)`);
}

console.log(
	"\nDone — wrote",
	CARDS.length + WRITING_CARDS.length,
	"cards to public/og/",
);
