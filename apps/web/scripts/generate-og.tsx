/**
 * Generates the per-route OG share cards in public/og/*.png.
 *
 * Run from apps/web:  bun run og
 *
 * Each card is a 1200×630 frame in the Primaries brand: a mono eyebrow, a
 * two-beat Geist headline whose second beat sits on the yellow highlight, flat
 * product art on the right, and a footer strip with the logo and the page
 * path. Data-driven, so a copy change is one CARDS edit + a re-run.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { STACKS_SYMBOL_PATH } from "../src/app/robinhood/stacks-symbol";
import { type Chain, MARKS } from "../src/components/site/chain-marks";
import { parseAnnotations } from "../src/lib/code/annotations";
import { POSTS, getPublishedPosts, longDate } from "../src/lib/writing";

const FONT_DIR = join(process.cwd(), "src/assets/og-fonts");
const OUT_DIR = join(process.cwd(), "public/og");

const [geist, geistMed, mono, monoMed, feather] = await Promise.all([
	readFile(join(FONT_DIR, "Geist-Regular.ttf")),
	readFile(join(FONT_DIR, "Geist-Medium.ttf")),
	readFile(join(FONT_DIR, "GeistMono-Regular.ttf")),
	readFile(join(FONT_DIR, "GeistMono-Medium.ttf")),
	// Official Robinhood Chain feather avatar (black on Robin Neon), unmodified.
	readFile(join(process.cwd(), "public/robinhood-chain/feather.jpg")),
]);
const FEATHER_SRC = `data:image/jpeg;base64,${feather.toString("base64")}`;

const SIZE = { width: 1200, height: 630 };

// palette: Primaries brand tokens (blue action, yellow highlight, red failure)
const PAPER = "#ffffff";
const INK = "#111111";
const SUB = "#5e5e5e";
const LINE = "#e5e5e2";
const SOFT = "#f5f5f2";
const BLUE = "#1f45e0";
const YELLOW = "#ffcc00";
const OK = "#128a43";
const ALARM = "#e3301e";
// dark terminal art
const TERM_BG = "#121316";
// from lib/syntax-theme.ts dark theme
const CODE_FG = "#d9dbe0";
const CODE_MUTED = "#8b9099";
const CODE_ACCENT = "#ffd21f";
const TERM_OK = "#3ccb7f"; // terminal success green (term-ok)

// Non-breaking space: satori collapses regular spaces at span boundaries, so
// inter-token whitespace would vanish. Geist Mono is monospace, so nbsp keeps
// the same advance width.
const NB = "\u00a0";
const nb = (s: string) => s.replace(/ /g, NB);

function LogoMark({ width = 40 }: { width?: number }) {
	return (
		<svg
			viewBox="6 9 36 24"
			width={width}
			height={(width * 24) / 36}
			role="img"
			aria-label="secondlayer"
		>
			<polygon points="8,23 28,15 40,23 20,31" fill={INK} opacity={0.24} />
			<polygon points="8,19 28,11 40,19 20,27" fill={BLUE} />
		</svg>
	);
}

// ── art primitives ───────────────────────────────────────────────────────────

function T({
	children,
	size = 18,
	color = INK,
	weight = 400,
	style,
}: {
	children: React.ReactNode;
	size?: number;
	color?: string;
	weight?: 400 | 500;
	style?: React.CSSProperties;
}) {
	return (
		<span
			style={{
				fontFamily: "Geist Mono",
				fontWeight: weight,
				fontSize: size,
				color,
				...style,
			}}
		>
			{typeof children === "string" ? nb(children) : children}
		</span>
	);
}

function Pill({
	children,
	bg,
	color,
	size = 17,
}: {
	children: string;
	bg: string;
	color: string;
	size?: number;
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				padding: "6px 16px",
				borderRadius: 999,
				background: bg,
				alignSelf: "flex-start",
			}}
		>
			<T size={size} color={color} weight={500}>
				{children}
			</T>
		</div>
	);
}

function Box({
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
				background: PAPER,
				border: `1.5px solid ${INK}`,
				borderRadius: 10,
				...style,
			}}
		>
			{children}
		</div>
	);
}

function KV({ k, v }: { k: string; v: string }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
			}}
		>
			<T size={16} color={SUB}>
				{k}
			</T>
			<T size={17}>{v}</T>
		</div>
	);
}

function VLine({ height }: { height: number }) {
	return <div style={{ width: 1.5, height, background: INK }} />;
}

// ── artifacts (flat, simplified from the page heroes) ────────────────────────

/** One mark from the site's chips, colored inline (satori has no CSS). */
function Mark({ chain, size }: { chain: Chain; size: number }) {
	const { size: box, shapes, colors } = MARKS[chain];
	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${box} ${box}`}
			aria-hidden="true"
		>
			{shapes.map((shape, i) =>
				"rx" in shape ? (
					<rect
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed shapes, never reordered
						key={i}
						width={box}
						height={box}
						rx={shape.rx}
						fill={colors[shape.role]}
					/>
				) : shape.stroke ? (
					<path
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed shapes, never reordered
						key={i}
						d={shape.d}
						transform={shape.transform}
						fill="none"
						stroke={colors[shape.role]}
						strokeWidth={9}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				) : (
					<path
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed shapes, never reordered
						key={i}
						d={shape.d}
						transform={shape.transform}
						fill={colors[shape.role]}
					/>
				),
			)}
		</svg>
	);
}

/** The home card names what it indexes, each with its mark, as the site does. */
function ArtHome() {
	const chains: [Chain, string][] = [
		["stacks", "Stacks"],
		["sbtc", "sBTC"],
		["runes", "Runes"],
		["bitcoin", "Bitcoin"],
	];
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 18 }}>
			{chains.map(([chain, name], i) => (
				<div
					key={chain}
					style={{ display: "flex", alignItems: "center", gap: 18 }}
				>
					{i > 0 ? <span style={{ fontSize: 26, color: SUB }}>·</span> : null}
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<Mark chain={chain} size={30} />
						<span
							style={{
								fontFamily: "Geist",
								fontWeight: 500,
								fontSize: 30,
								color: SUB,
								letterSpacing: -0.6,
							}}
						>
							{name}
						</span>
					</div>
				</div>
			))}
		</div>
	);
}

function ArtIndex() {
	return (
		<div
			style={{
				position: "relative",
				display: "flex",
				flexDirection: "column",
				width: 440,
				height: 440,
			}}
		>
			<Box
				style={{
					position: "absolute",
					top: 0,
					left: 70,
					width: 360,
					height: 150,
					borderColor: LINE,
					padding: "12px 18px",
				}}
			>
				<T size={15} color={SUB}>
					contract_call
				</T>
			</Box>
			<Box
				style={{
					position: "absolute",
					top: 34,
					left: 36,
					width: 360,
					height: 150,
					borderColor: LINE,
					padding: "12px 18px",
				}}
			>
				<T size={15} color={SUB}>
					nft_mint
				</T>
			</Box>
			<Box
				style={{
					position: "absolute",
					top: 68,
					left: 0,
					width: 380,
					padding: "18px 22px",
					gap: 12,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						paddingBottom: 12,
						borderBottom: `1px solid ${LINE}`,
					}}
				>
					<T size={22} weight={500}>
						ft_transfer
					</T>
					<div
						style={{
							display: "flex",
							padding: "3px 10px",
							borderRadius: 5,
							background: YELLOW,
						}}
					>
						<T size={15} weight={500}>
							event 12
						</T>
					</div>
				</div>
				<KV k="block_height" v="8,948,506" />
				<KV k="contract" v="SM3V…sbtc-token" />
				<KV k="sender" v="SP2J…R4K" />
				<KV k="amount" v="25,000,000" />
			</Box>
			<div
				style={{
					position: "absolute",
					top: 330,
					left: 190,
					display: "flex",
				}}
			>
				<VLine height={36} />
			</div>
			<div
				style={{ position: "absolute", top: 366, left: 40, display: "flex" }}
			>
				<Pill bg={BLUE} color={PAPER} size={19}>
					next_cursor 8948506:12
				</Pill>
			</div>
		</div>
	);
}

function ArtStreams() {
	const cells: {
		top: string;
		bot: string;
		kind: "read" | "cursor" | "next";
	}[] = [
		{ top: "506:19", bot: "read", kind: "read" },
		{ top: "506:24", bot: "read", kind: "read" },
		{ top: "507:03", bot: "cursor", kind: "cursor" },
		{ top: "507:08", bot: "next", kind: "next" },
		{ top: "507:11", bot: "tip", kind: "next" },
	];
	return (
		<div style={{ display: "flex", flexDirection: "column", width: 440 }}>
			<T size={16} color={SUB}>
				block_height 8,948,506 → 8,948,508
			</T>
			<div style={{ display: "flex", gap: 8, marginTop: 18 }}>
				{cells.map((c) => (
					<div
						key={c.top}
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							gap: 6,
							width: 80,
							height: 92,
							borderRadius: 8,
							background: c.kind === "cursor" ? BLUE : PAPER,
							border:
								c.kind === "cursor"
									? `1.5px solid ${BLUE}`
									: c.kind === "next"
										? `1.5px dashed ${SUB}`
										: `1.5px solid ${LINE}`,
						}}
					>
						<T
							size={17}
							weight={500}
							color={
								c.kind === "cursor" ? PAPER : c.kind === "next" ? SUB : INK
							}
						>
							{c.top}
						</T>
						<T size={15} color={c.kind === "cursor" ? PAPER : SUB}>
							{c.bot}
						</T>
					</div>
				))}
			</div>
			<div style={{ display: "flex", paddingLeft: 196, marginTop: 4 }}>
				<VLine height={44} />
			</div>
			<Box style={{ padding: "20px 24px", gap: 10, marginTop: 4 }}>
				<T size={15} color={SUB}>
					your checkpoint
				</T>
				<T size={24} weight={500}>
					{'cursor = "8948507:03"'}
				</T>
				<T size={15} color={SUB}>
					kill it, pass --cursor, resume here
				</T>
			</Box>
		</div>
	);
}

function ArtSubgraphs() {
	const code: [number, string][] = [
		[0, "defineSubgraph({"],
		[2, "sources: { transfers },"],
		[2, "schema: { transfers },"],
		[2, "handlers: { insert },"],
		[0, "})"],
	];
	const rows: [string, string, string][] = [
		["9,137,002", "SP3PE…X44J", "697,078,828"],
		["9,137,004", "SP2J6…R4K", "25,000,000"],
	];
	return (
		<div style={{ display: "flex", flexDirection: "column", width: 440 }}>
			<Box
				style={{
					width: 330,
					background: SOFT,
					borderColor: LINE,
					padding: "14px 22px",
					gap: 4,
				}}
			>
				<T size={16} color={SUB} style={{ marginBottom: 6 }}>
					sbtc-flows.ts
				</T>
				{code.map(([indent, line]) => (
					<T key={line} size={19} color={indent ? SUB : INK}>
						{`${NB.repeat(indent)}${line}`}
					</T>
				))}
			</Box>
			<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
				<div style={{ display: "flex", paddingLeft: 164 }}>
					<VLine height={40} />
				</div>
				<T size={15} color={SUB}>
					deploy
				</T>
			</div>
			<Box>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						padding: "12px 20px",
						borderBottom: `1px solid ${LINE}`,
					}}
				>
					<T size={14} color={SUB}>
						_block_height
					</T>
					<T size={14} color={SUB}>
						sender
					</T>
					<T size={14} color={SUB}>
						amount
					</T>
				</div>
				{rows.map(([h, s, a]) => (
					<div
						key={h}
						style={{
							display: "flex",
							justifyContent: "space-between",
							padding: "12px 20px",
							borderBottom: `1px solid ${LINE}`,
						}}
					>
						<T size={16}>{h}</T>
						<T size={16}>{s}</T>
						<T size={16}>{a}</T>
					</div>
				))}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						padding: "12px 20px",
						background: YELLOW,
						borderRadius: "0 0 8px 8px",
					}}
				>
					<T size={16} weight={500}>
						9,137,007
					</T>
					<T size={16} weight={500}>
						SP3F1…Q9A
					</T>
					<T size={16} weight={500}>
						250,000
					</T>
				</div>
			</Box>
		</div>
	);
}

function ArtWebhooks() {
	const rows: { code: string; color: string; note: string; trig: string }[] = [
		{ code: "200", color: OK, note: "84 ms", trig: "contract_call" },
		{ code: "200", color: OK, note: "91 ms", trig: "ft_transfer" },
		{ code: "503", color: ALARM, note: "retrying", trig: "contract_call" },
		{ code: "200", color: OK, note: "77 ms", trig: "retried" },
	];
	return (
		<div style={{ display: "flex", flexDirection: "column", width: 440 }}>
			<Box>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						padding: "16px 22px",
						borderBottom: `1px solid ${LINE}`,
					}}
				>
					<T size={19} weight={500}>
						amm-swaps
					</T>
					<T size={15} color={SUB}>
						→ my-app.com/webhook
					</T>
				</div>
				{rows.map((r, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static render
						key={i}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 12,
							height: 56,
							padding: "0 22px",
							borderBottom: `1px solid ${LINE}`,
						}}
					>
						<div
							style={{
								width: 11,
								height: 11,
								borderRadius: 6,
								background: r.color,
							}}
						/>
						<T size={20} weight={500} color={r.color} style={{ width: 54 }}>
							{r.code}
						</T>
						<T size={17} style={{ width: 110 }}>
							{r.note}
						</T>
						<T size={16} color={SUB}>
							{r.trig}
						</T>
					</div>
				))}
				<div style={{ display: "flex", padding: "16px 22px" }}>
					<Pill bg={YELLOW} color={INK}>
						signed · ed25519
					</Pill>
				</div>
			</Box>
		</div>
	);
}

function ArtArchive() {
	const files: [string, string, string][] = [
		["blocks/", "3.15%", "8940000-8949999-e4ea….parquet"],
		["transactions/", "10.31%", "8940000-8949999-9b1c….parquet"],
		["events/", "86.53%", "8940000-8949999-03d7….parquet"],
	];
	return (
		<div style={{ display: "flex", flexDirection: "column", width: 440 }}>
			<div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
				<div
					style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}
				>
					{files.map(([dir, pct, name]) => (
						<Box key={dir} style={{ padding: "14px 18px", gap: 6 }}>
							<div style={{ display: "flex", justifyContent: "space-between" }}>
								<T size={19} weight={500}>
									{dir}
								</T>
								<T size={16} color={SUB}>
									{pct}
								</T>
							</div>
							<T size={13} color={SUB}>
								{name}
							</T>
						</Box>
					))}
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						width: 92,
						borderRadius: 10,
						background: YELLOW,
						gap: 4,
					}}
				>
					<T size={18} weight={500}>
						signed
					</T>
					<T size={13}>ed25519</T>
				</div>
			</div>
			<Box style={{ marginTop: 22, padding: "16px 22px", gap: 8 }}>
				<KV k="blocks" v="8,948,507" />
				<KV k="span 0 → 8,948,506" v="8,948,507" />
				<div
					style={{
						display: "flex",
						paddingTop: 8,
						borderTop: `1px solid ${LINE}`,
					}}
				>
					<T size={16} weight={500}>
						difference 0 · no room for a gap
					</T>
				</div>
			</Box>
		</div>
	);
}

function ArtVerify() {
	const steps: [string, string][] = [
		["Checkpoint", "trusted as-is"],
		["Bitcoin headers", "proof of work"],
		["Signer set", "≥ 70% weight"],
		["Stacks block", "tx merkle root"],
		["State root", "witness + MARF"],
		["Your row", "matches a proven leaf"],
	];
	return (
		<div style={{ display: "flex", flexDirection: "column", width: 400 }}>
			{steps.map(([name, sub], i) => {
				const last = i === steps.length - 1;
				return (
					<div key={name} style={{ display: "flex", flexDirection: "column" }}>
						<Box
							style={{
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
								height: 52,
								padding: "0 20px",
								background: last ? YELLOW : i === 0 ? SOFT : PAPER,
								borderColor: i === 0 ? LINE : INK,
							}}
						>
							<T size={18} weight={500} color={INK}>
								{name}
							</T>
							<T size={14} color={last ? INK : SUB}>
								{sub}
							</T>
						</Box>
						{last ? null : (
							<div style={{ display: "flex", paddingLeft: 40 }}>
								<VLine height={16} />
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function ArtPricing() {
	const lines: [string, string, string | null][] = [
		["Rows delivered", "6,000,000", "$25.00"],
		["Block headers", "43,800", null],
		["Hosted stack", "0.5 GB × 730 h", "$10.32"],
		["Webhook events", "800,000", "$8.00"],
		["Webhook retries", "3,214", null],
		["verify · proofs", "31 checks", null],
	];
	return (
		<Box style={{ width: 440 }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					padding: "16px 22px",
					borderBottom: `1px solid ${LINE}`,
				}}
			>
				<T size={18} weight={500}>
					Statement · October
				</T>
				<T size={14} color={SUB}>
					example month
				</T>
			</div>
			{lines.map(([label, qty, amt]) => (
				<div
					key={label}
					style={{
						display: "flex",
						alignItems: "center",
						height: 50,
						padding: "0 22px",
						borderBottom: `1px solid ${LINE}`,
					}}
				>
					<T size={16} style={{ width: 168 }}>
						{label}
					</T>
					<T size={14} color={SUB} style={{ flex: 1 }}>
						{qty}
					</T>
					{amt ? (
						<T size={17}>{amt}</T>
					) : (
						<div
							style={{
								display: "flex",
								padding: "2px 10px",
								borderRadius: 5,
								background: SOFT,
							}}
						>
							<T size={15} weight={500} color={OK}>
								free
							</T>
						</div>
					)}
				</div>
			))}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "16px 22px",
				}}
			>
				<T size={18} color={SUB}>
					Total
				</T>
				<T size={28} weight={500}>
					$43.32
				</T>
			</div>
		</Box>
	);
}

function ArtDocs() {
	const checks = [
		"proof of work · Bitcoin header",
		"signer set · ≥ 70% signed",
		"tx merkle root matches",
		"state root matches a proven leaf",
	];
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: 440,
				background: TERM_BG,
				borderRadius: 10,
				padding: "26px 28px",
				gap: 10,
			}}
		>
			<div style={{ display: "flex", flexWrap: "wrap" }}>
				<T size={17} color={CODE_MUTED}>
					${NB}
				</T>
				<T size={17} color={CODE_ACCENT} weight={500}>
					secondlayer{NB}
				</T>
				<T size={17} color={CODE_FG}>
					verify block{NB}
				</T>
				<T size={17} color={CODE_FG}>
					9137005
				</T>
			</div>
			{checks.map((c) => (
				<div key={c} style={{ display: "flex", gap: 10 }}>
					<svg
						viewBox="0 0 16 16"
						width="18"
						height="18"
						role="img"
						aria-label="passed"
					>
						<path
							d="M3 8.5 6.5 12 13 4.5"
							fill="none"
							stroke={TERM_OK}
							strokeWidth="2"
						/>
					</svg>
					<T size={17} color={CODE_FG}>
						{c}
					</T>
				</div>
			))}
			<T size={15} color={CODE_MUTED} style={{ marginTop: 6 }}>
				verified against your checkpoint
			</T>
		</div>
	);
}

// The /robinhood round trip: the original SIP-010 and its ERC-20 twin, linked
// 1:1 — the same twin cards as the page, full strength, since they are the
// point of the card rather than background texture.

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
				border: `1.5px solid ${LINE}`,
				borderRadius: 18,
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
							fontFamily: "Geist",
							fontWeight: 500,
							fontSize: 30,
							color: INK,
						}}
					>
						{name}
					</span>
					<span
						style={{
							fontFamily: "Geist Mono",
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
							fontFamily: "Geist Mono",
							fontSize: 18,
							color: "SUB",
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
								fontFamily: "Geist Mono",
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
							background: SOFT,
							border: `1.5px solid ${LINE}`,
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
				stateColor={SUB}
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
						width: 0,
						height: 104,
						borderLeft: `2px dashed ${SUB}`,
					}}
				/>
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					<span
						style={{
							fontFamily: "Geist Mono",
							fontWeight: 500,
							fontSize: 24,
							color: INK,
						}}
					>
						{"1 : 1".replace(/ /g, NB)}
					</span>
					<span
						style={{
							fontFamily: "Geist Mono",
							fontSize: 18,
							color: "SUB",
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
				stateColor={OK}
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
	/** line2 may hold "|" to break the highlight into lines. Size is headline px. */
	size: number;
	/** Footer path, e.g. secondlayer.tools/streams */
	path: string;
	artifact: React.ReactNode;
	/** Highlight color behind line 2 (yellow; Robin Neon on the partner card). */
	highlight?: string;
	/** Headline across the card's full width with the artifact underneath
	    (home), matching the home hero. Default is headline left, artifact
	    right. */
	wide?: boolean;
};

function Footer({ path }: { path: string }) {
	return (
		<div
			style={{
				position: "absolute",
				left: 80,
				right: 80,
				bottom: 48,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				borderTop: `1px solid ${LINE}`,
				paddingTop: 22,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
				<LogoMark />
				<span
					style={{
						fontFamily: "Geist",
						fontWeight: 500,
						fontSize: 30,
						color: INK,
						letterSpacing: -0.9,
					}}
				>
					secondlayer
				</span>
			</div>
			<T size={20} color={SUB}>
				{path}
			</T>
		</div>
	);
}

function WideFrame(spec: CardSpec) {
	const { size } = spec;
	const [plain, marked] = spec.line2.includes("|")
		? spec.line2.split("|")
		: ["", spec.line2];
	const hl = spec.highlight ?? YELLOW;
	const line = {
		fontFamily: "Geist",
		fontWeight: 500,
		fontSize: size,
		color: INK,
		lineHeight: 1.1,
		letterSpacing: -size * 0.05,
	};
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: PAPER,
				padding: "0 80px",
				fontFamily: "Geist",
			}}
		>
			<div
				style={{
					height: 540,
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-start",
					justifyContent: "center",
					gap: 44,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "flex-start",
					}}
				>
					<span style={line}>{spec.line1}</span>
					{/* "plain|highlighted": line 2 can lead with unmarked words. */}
					<div style={{ display: "flex", alignItems: "baseline" }}>
						{plain ? (
							<span style={{ ...line, marginRight: 22 }}>{plain}</span>
						) : null}
						<span
							style={{
								...line,
								background: hl,
								padding: "0 16px",
								marginLeft: plain ? 0 : -16,
							}}
						>
							{marked}
						</span>
					</div>
				</div>
				{spec.artifact}
			</div>
			<Footer path={spec.path} />
		</div>
	);
}

function Frame(spec: CardSpec) {
	if (spec.wide) return <WideFrame {...spec} />;
	const { size } = spec;
	const hl = spec.highlight ?? YELLOW;
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: PAPER,
				padding: "0 80px",
				fontFamily: "Geist",
			}}
		>
			<div
				style={{
					position: "absolute",
					top: 60,
					left: 680,
					width: 440,
					height: 470,
					display: "flex",
					alignItems: "center",
				}}
			>
				{spec.artifact}
			</div>

			<div
				style={{
					position: "relative",
					width: 580,
					height: 540,
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					gap: 26,
				}}
			>
				{spec.eyebrow ? (
					<T size={20} color={SUB} style={{ letterSpacing: 2 }}>
						{spec.eyebrow}
					</T>
				) : null}
				<div style={{ display: "flex", flexDirection: "column" }}>
					<span
						style={{
							fontFamily: "Geist",
							fontWeight: 500,
							fontSize: size,
							color: INK,
							lineHeight: 1.1,
							letterSpacing: -size * 0.04,
						}}
					>
						{spec.line1}
					</span>
					{spec.line2.split("|").map((beat) => (
						<span
							key={beat}
							style={{
								fontFamily: "Geist",
								fontWeight: 500,
								fontSize: size,
								color: INK,
								lineHeight: 1.1,
								letterSpacing: -size * 0.04,
								alignSelf: "flex-start",
								background: hl,
								padding: "0 14px",
								marginLeft: -14,
							}}
						>
							{beat}
						</span>
					))}
				</div>
			</div>

			<Footer path={spec.path} />
		</div>
	);
}

const SITE = "secondlayer.tools";

const CARDS: CardSpec[] = [
	{
		file: "home.png",
		eyebrow: null,
		line1: "Instant data for apps on",
		line2: "Bitcoin.|Proof included.",
		size: 88,
		path: SITE,
		wide: true,
		artifact: <ArtHome />,
	},
	{
		file: "index.png",
		eyebrow: "INDEX · QUERY DECODED ROWS",
		line1: "The whole chain,",
		line2: "already decoded.",
		size: 68,
		path: `${SITE}/index`,
		artifact: <ArtIndex />,
	},
	{
		file: "streams.png",
		eyebrow: "STREAMS · STREAM RAW EVENTS",
		line1: "Hold your",
		line2: "own cursor.",
		size: 88,
		path: `${SITE}/streams`,
		artifact: <ArtStreams />,
	},
	{
		file: "subgraphs.png",
		eyebrow: "SUBGRAPHS · INDEX YOUR CONTRACT",
		line1: "Your contract,",
		line2: "as a table.",
		size: 80,
		path: `${SITE}/subgraphs`,
		artifact: <ArtSubgraphs />,
	},
	{
		file: "webhooks.png",
		eyebrow: "WEBHOOKS · GET TOLD FIRST",
		line1: "Your server,",
		line2: "told first.",
		size: 88,
		path: `${SITE}/webhooks`,
		artifact: <ArtWebhooks />,
	},
	{
		file: "archive.png",
		eyebrow: "ARCHIVE · RESTORE SIGNED HISTORY",
		line1: "Signed history.",
		line2: "Check your copy|for free.",
		size: 60,
		path: `${SITE}/archive`,
		artifact: <ArtArchive />,
	},
	{
		file: "verify.png",
		eyebrow: "VERIFY",
		line1: "Trust,",
		line2: "and verify.",
		size: 88,
		path: `${SITE}/verify`,
		artifact: <ArtVerify />,
	},
	{
		file: "pricing.png",
		eyebrow: "PRICING",
		line1: "Pay for rows delivered.",
		line2: "Checking is free.",
		size: 56,
		path: `${SITE}/pricing`,
		artifact: <ArtPricing />,
	},
	{
		file: "docs.png",
		eyebrow: "DOCS",
		line1: "Instant data for apps on Bitcoin.",
		line2: "Read the docs.",
		size: 56,
		path: `${SITE}/docs`,
		artifact: <ArtDocs />,
	},
	{
		file: "robinhood.png",
		eyebrow: "WAITLIST · SIP-010",
		line1: "Don't mint a copy.",
		line2: "Bridge the original.",
		size: 60,
		path: `${SITE}/robinhood`,
		artifact: <ArtRobinhood />,
	},
];

const fonts = [
	{
		name: "Geist",
		data: geist,
		weight: 400 as const,
		style: "normal" as const,
	},
	{
		name: "Geist",
		data: geistMed,
		weight: 500 as const,
		style: "normal" as const,
	},
	{
		name: "Geist Mono",
		data: mono,
		weight: 400 as const,
		style: "normal" as const,
	},
	{
		name: "Geist Mono",
		data: monoMed,
		weight: 500 as const,
		style: "normal" as const,
	},
];

// ── blog cards ───────────────────────────────────────────────────────────────
// A post card is the post's title on the left and its own code on the right:
// up to seven lines of the post's first real code block, in the site's syntax
// ladder, with the token the post marks on yellow. Nothing to set per post.

const FAINT = "#9b9b96";
const POSTS_DIR = join(process.cwd(), "src/app/(www)/writing/(post)");
const EXCERPT_LINES = 7;
const EXCERPT_CHARS = 38;

type Excerpt = { lines: string[]; mark: { line: number; re: RegExp } | null };

/**
 * The card's art: the first fence of 4+ lines. A transcript keeps its command
 * and its last lines (the result); code keeps a window around its first
 * `!mark` or `!callout`, whose token is the one marked.
 */
async function heroExcerpt(slug: string): Promise<Excerpt | null> {
	const mdx = await readFile(join(POSTS_DIR, slug, "page.mdx"), "utf8");
	for (const [, lang = "", body = ""] of mdx.matchAll(
		/```(\w*)[^\n]*\n([\s\S]*?)```/g,
	)) {
		const { lines, annotations } = parseAnnotations(body.trimEnd(), lang);
		if (lines.length < 4) continue;
		let picked: string[];
		let mark: Excerpt["mark"] = null;
		if (lang === "text") {
			picked = [lines[0] ?? "", ...lines.slice(1 - EXCERPT_LINES)];
			mark = { line: picked.length - 1, re: /(?<=✓ ).*?\./ };
		} else {
			const note = annotations.find(
				(a) => (a.name === "mark" || a.name === "callout") && a.regex,
			);
			const at = note?.from ?? 0;
			const start = Math.max(0, Math.min(at - 3, lines.length - EXCERPT_LINES));
			picked = lines.slice(start, start + EXCERPT_LINES);
			if (note?.regex) mark = { line: at - start, re: note.regex };
		}
		const indent = Math.min(
			...picked
				.filter((l) => l.trim())
				.map((l) => /^ */.exec(l)?.[0].length ?? 0),
		);
		return {
			lines: picked.map((l) => {
				// Transcripts pad columns with runs of spaces; two keep the shape.
				const line = l.slice(indent).replace(/(\S) {3,}/g, "$1  ");
				if (line.length <= EXCERPT_CHARS) return line;
				const cut = line.lastIndexOf(" ", EXCERPT_CHARS - 1);
				return `${line.slice(0, cut > EXCERPT_CHARS / 2 ? cut : EXCERPT_CHARS - 1)}…`;
			}),
			mark,
		};
	}
	return null;
}

/** ✓ as a drawn check: Geist Mono has no glyph for it, and satori would
    fetch a fallback font over the network. One character wide. */
function Check() {
	return (
		<svg
			width={10.2}
			height={28}
			viewBox="0 0 10.2 28"
			role="img"
			aria-label="passed"
		>
			<path
				d="M1 15.5 L4 18.5 L9.2 11"
				fill="none"
				stroke={OK}
				strokeWidth={1.6}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

/** One line in the syntax ladder: keys sub, punctuation faint, ✓ green. */
function CodeTokens({ text }: { text: string }) {
	const parts = text.match(
		/("(?:[^"\\]|\\.)*"(?=\s*:)|[A-Za-z_$][\w$]*(?=\s*:)|"(?:[^"\\]|\\.)*"|[{}[\](),:;=]|✓|^\$|\s+|[^\s{}[\](),:;="✓]+)/g,
	);
	return (
		<>
			{(parts ?? []).map((t, i) => {
				const key =
					/^"?[\w$]+"?$/.test(t) &&
					text
						.slice(text.indexOf(t) + t.length)
						.trimStart()
						.startsWith(":");
				// biome-ignore lint/suspicious/noArrayIndexKey: tokens of one fixed line
				if (t === "✓") return <Check key={i} />;
				const color =
					/^[{}[\](),:;=]$/.test(t) || t === "$" ? FAINT : key ? SUB : INK;
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: tokens of one fixed line
					<span key={i} style={{ color }}>
						{nb(t)}
					</span>
				);
			})}
		</>
	);
}

function CodeExcerpt({ excerpt }: { excerpt: Excerpt }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: 440,
				border: `1px solid ${LINE}`,
				borderRadius: 8,
				padding: "20px 22px",
				fontFamily: "Geist Mono",
				fontSize: 17,
				lineHeight: "28px",
			}}
		>
			{excerpt.lines.map((line, i) => {
				const hit =
					excerpt.mark?.line === i ? excerpt.mark.re.exec(line) : null;
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed excerpt
					<div key={i} style={{ display: "flex", minHeight: 28 }}>
						{hit ? (
							<>
								<CodeTokens text={line.slice(0, hit.index)} />
								<span style={{ background: YELLOW, color: INK }}>
									{nb(hit[0])}
								</span>
								<CodeTokens text={line.slice(hit.index + hit[0].length)} />
							</>
						) : (
							<CodeTokens text={line} />
						)}
					</div>
				);
			})}
		</div>
	);
}

function PostFrame({
	eyebrow,
	title,
	meta,
	excerpt,
}: {
	eyebrow: string;
	title: string;
	meta: string;
	excerpt: Excerpt | null;
}) {
	const size = title.length > 40 ? 52 : 60;
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				display: "flex",
				background: PAPER,
				padding: "0 80px",
				fontFamily: "Geist",
			}}
		>
			<div
				style={{
					width: excerpt ? 540 : 1000,
					height: 540,
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					gap: 26,
				}}
			>
				<T size={20} color={SUB} style={{ letterSpacing: 2 }}>
					{eyebrow}
				</T>
				<span
					style={{
						fontWeight: 500,
						fontSize: size,
						color: INK,
						lineHeight: 1.08,
						letterSpacing: -size * 0.035,
					}}
				>
					{title}
				</span>
				<T size={20} color={SUB}>
					{meta}
				</T>
			</div>
			{excerpt ? (
				<div
					style={{
						position: "absolute",
						top: 0,
						right: 80,
						height: 540,
						display: "flex",
						alignItems: "center",
					}}
				>
					<CodeExcerpt excerpt={excerpt} />
				</div>
			) : null}
			<Footer path={`${SITE}/writing`} />
		</div>
	);
}

/** The index card's art: the latest published posts, as the index lists them. */
function ArtBlog() {
	const latest = getPublishedPosts()
		.sort((a, b) => b.number - a.number)
		.slice(0, 3);
	return (
		<div style={{ display: "flex", flexDirection: "column", width: 440 }}>
			{latest.map((post) => (
				<div
					key={post.slug}
					style={{
						display: "flex",
						gap: 18,
						padding: "18px 0",
						borderTop: `1px solid ${LINE}`,
					}}
				>
					<T size={16} color={SUB}>
						{String(post.number).padStart(2, "0")}
					</T>
					<span
						style={{
							fontFamily: "Geist",
							fontWeight: 500,
							fontSize: 24,
							lineHeight: 1.2,
							letterSpacing: -0.6,
							color: INK,
						}}
					>
						{post.title}
					</span>
				</div>
			))}
		</div>
	);
}

const WRITING_CARDS: { file: string; frame: React.ReactElement }[] = [
	{
		file: "writing.png",
		frame: (
			<Frame
				file="writing.png"
				eyebrow="BLOG"
				line1="Notes from"
				line2="the index."
				size={76}
				path={`${SITE}/writing`}
				artifact={<ArtBlog />}
			/>
		),
	},
	// All posts, drafts included — flipping a draft live shouldn't need a re-run.
	...(await Promise.all(
		POSTS.map(async (post) => ({
			file: `writing-${post.slug}.png`,
			frame: (
				<PostFrame
					eyebrow={`BLOG · ${String(post.number).padStart(2, "0")}`}
					title={post.title}
					meta={`${longDate(post.date)} · ${post.readingTime}`}
					excerpt={await heroExcerpt(post.slug)}
				/>
			),
		})),
	)),
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
