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
import { STACKS_SYMBOL_PATH } from "../src/app/robinhood/stacks-symbol";
import { POSTS } from "../src/lib/writing";

const FONT_DIR = join(process.cwd(), "src/assets/og-fonts");
const OUT_DIR = join(process.cwd(), "public/og");

const [sora, soraMed, fira, firaMed, feather] = await Promise.all([
	readFile(join(FONT_DIR, "Sora-SemiBold.ttf")),
	readFile(join(FONT_DIR, "Sora-Medium.woff")),
	readFile(join(FONT_DIR, "FiraCode-Regular.ttf")),
	readFile(join(FONT_DIR, "FiraCode-Medium.ttf")),
	// Official Robinhood Chain feather avatar (black on Robin Neon), unmodified.
	readFile(join(process.cwd(), "public/robinhood-chain/feather.jpg")),
]);
const FEATHER_SRC = `data:image/jpeg;base64,${feather.toString("base64")}`;

const SIZE = { width: 1200, height: 630 };

// palette — DESIGN.md tokens (quiet install page)
const PAPER = "#ffffff";
const INK = "#0a0a0a";
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

function ArtArchive() {
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
			<Card style={{ position: "absolute", top: 140, left: 745, width: 780 }}>
				<Line
					tokens={[
						["$ ", DIM],
						["secondlayer verify all \\", BASE],
					]}
				/>
				<Line
					indent={4}
					tokens={[
						["--against ", KW],
						["…/latest.json", STR],
					]}
				/>
				<Line
					tokens={[
						["✓ ", KW],
						["175 ranges match the archive", BASE],
					]}
				/>
				<Line indent={2} tokens={[["reference signature verified", DIM]]} />
			</Card>
			<Card style={{ position: "absolute", top: 400, left: 950, width: 620 }}>
				<Line tokens={[["latest.json", KW]]} />
				<Line
					tokens={[
						["snapshot ", DIM],
						["canonical-v1 · #8,748,855", BASE],
					]}
				/>
				<Line
					tokens={[
						["sha256 ", DIM],
						["a2c22b25…", STR],
					]}
				/>
			</Card>
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

// The /robinhood round trip: the original SIP-010 and its ERC-20 twin, linked
// 1:1 — the same twin cards as the page, full strength, since they are the
// point of the card rather than background texture.
const NEON = "#ccff00"; // Robin Neon, headline highlight only

function TwinToken({
	coin,
	name,
	meta,
	state,
	stateColor,
}: {
	coin: React.ReactNode;
	name: string;
	meta: string;
	state: string;
	stateColor: string;
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 20,
				padding: "24px 26px",
				background: PAPER,
				border: "1.5px solid rgba(10,10,10,0.13)",
				borderRadius: 18,
				boxShadow: CARD_SHADOW,
			}}
		>
			{coin}
			<div
				style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}
			>
				{/* name ↔ amount on top; chain line ↔ state underneath */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<span
						style={{
							fontFamily: "Sora",
							fontWeight: 500,
							fontSize: 30,
							color: INK,
						}}
					>
						{name}
					</span>
					<span
						style={{
							fontFamily: "Fira Code",
							fontWeight: 500,
							fontSize: 30,
							color: INK,
						}}
					>
						1,000
					</span>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<span
						style={{
							fontFamily: "Fira Code",
							fontSize: 18,
							color: "rgba(10,10,10,0.42)",
						}}
					>
						{meta.replace(/ /g, NB)}
					</span>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<div
							style={{
								width: 10,
								height: 10,
								borderRadius: 5,
								background: stateColor,
							}}
						/>
						<span
							style={{
								fontFamily: "Fira Code",
								fontSize: 18,
								color: stateColor,
							}}
						>
							{state}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function ArtRobinhood() {
	return (
		<div
			style={{
				position: "absolute",
				top: 150,
				left: 720,
				width: 420,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<TwinToken
				coin={
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: 60,
							height: 60,
							borderRadius: 30,
							background: "#f8f6f2",
							border: "1.5px solid rgba(10,10,10,0.13)",
						}}
					>
						<svg
							viewBox="0 0 82 83"
							width="30"
							height="30"
							role="img"
							aria-label="Stacks"
						>
							<path
								fillRule="evenodd"
								clipRule="evenodd"
								d={STACKS_SYMBOL_PATH}
								fill={INK}
							/>
						</svg>
					</div>
				}
				name="SIP-010"
				meta="Stacks"
				state="locked"
				stateColor={ACCENT}
			/>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					height: 104,
					paddingLeft: 55,
					gap: 40,
				}}
			>
				<div
					style={{
						width: 2,
						height: 104,
						backgroundImage:
							"linear-gradient(to bottom, rgba(10,10,10,0.25) 50%, rgba(10,10,10,0) 50%)",
						backgroundSize: "2px 12px",
					}}
				/>
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					<span
						style={{
							fontFamily: "Fira Code",
							fontWeight: 500,
							fontSize: 24,
							color: INK,
						}}
					>
						{"1 : 1".replace(/ /g, NB)}
					</span>
					<span
						style={{
							fontFamily: "Fira Code",
							fontSize: 18,
							color: "rgba(10,10,10,0.45)",
						}}
					>
						{"burn the twin to unlock".replace(/ /g, NB)}
					</span>
				</div>
			</div>
			<TwinToken
				coin={
					<img
						src={FEATHER_SRC}
						width={60}
						height={60}
						style={{ borderRadius: 30 }}
						alt=""
					/>
				}
				name="ERC-20"
				meta="chain 4663"
				state="live"
				stateColor="#15803d"
			/>
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
	/** Marker-style highlight behind line 2 (the page's headline treatment). */
	highlightLine2?: string;
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
							fontWeight: 400,
							fontSize: size,
							color: INK,
							lineHeight: 1.04,
							letterSpacing: -size * 0.025,
							...(spec.highlightLine2
								? {
										alignSelf: "flex-start",
										backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0) 60%, ${spec.highlightLine2} 60%, ${spec.highlightLine2} 92%, rgba(0,0,0,0) 92%)`,
									}
								: {}),
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
		line1: "Self-hosted",
		line2: "Stacks runtime.",
		mutedLine2: true,
		artifact: <ArtHome />,
	},
	{
		file: "archive.png",
		eyebrow: "ARCHIVE",
		line1: "The verified",
		line2: "Stacks archive.",
		mutedLine2: true,
		artifact: <ArtArchive />,
	},
	{
		file: "robinhood.png",
		eyebrow: "WAITLIST · SIP-010",
		line1: "Don't mint a copy.",
		line2: "Bridge the original.",
		mutedLine2: false,
		highlightLine2: NEON,
		artifact: <ArtRobinhood />,
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
