/**
 * Generates the repo README hero: .github/assets/hero-{light,dark}.svg.
 *
 * Run from apps/web:  bun run readme-hero
 *
 * GitHub draws README SVGs as images, which can't load web fonts, so every
 * glyph is outlined to a path here from the same Geist files the OG cards use.
 * Layout: headline, one line under it and three facts on the left; faded
 * "> question → /v1 route" lines behind on the right. Static on purpose: the
 * install command lives in the README's Install section, where it can be copied.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Font, parse } from "opentype.js";

const FONT_DIR = join(process.cwd(), "src/assets/og-fonts");
const OUT_DIR = join(process.cwd(), "../../.github/assets");

const load = async (file: string) => {
	const buf = await readFile(join(FONT_DIR, file));
	return parse(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	);
};
const [sans, sansMed, mono] = await Promise.all([
	load("Geist-Regular.ttf"),
	load("Geist-Medium.ttf"),
	load("GeistMono-Regular.ttf"),
]);

// Brand roles from DESIGN.md. Blue = what you can use (the routes), ink
// invert = the headline beat, neutrals carry the rest.
const PALETTES = {
	light: {
		paper: "#fbfaf7",
		ink: "#14110d",
		sub: "#63605c",
		faint: "#9d9b97",
		line: "#e8e6e3",
		pri: "#1f45e0",
	},
	dark: {
		paper: "#1e1b17",
		ink: "#e8e6e3",
		sub: "#b3b1ad",
		faint: "#7c7a76",
		line: "#393632",
		pri: "#3a5bff",
	},
} as const;
type Palette = (typeof PALETTES)[keyof typeof PALETTES];

/** Middle rows read clearest, so contract state sits there. */
const QUESTIONS: [string, string][] = [
	["is my copy of history complete", "/v1/index/canonical"],
	["every sBTC transfer since block 1", "/v1/index/ft-transfers"],
	["who stacked with this signer", "/v1/index/pox/cycles"],
	["my contract as a table I can query", "/v1/subgraphs/:name/:table"],
	["who changed this vault's positions", "/v1/index/state-writes"],
	["every call into my pool, even via routers", "/v1/index/contract-calls"],
	["rune balances for this wallet", "/v1/index/runes"],
	["the raw node feed from any block", "/v1/streams/events"],
	["did a reorg cross my cursor", "/v1/streams/reorgs"],
];
const FACTS: [string, string][] = [
	["1M", "rows free every month"],
	["Block 1", "decoded from genesis"],
	["MIT", "self-host free forever"],
];

const W = 960;
const H = 360;

/** Width of `text` at `size`, kerning included, plus `tracking` px per glyph. */
function measure(font: Font, text: string, size: number, tracking = 0) {
	const glyphs = font.stringToGlyphs(text);
	const scale = size / font.unitsPerEm;
	let w = 0;
	glyphs.forEach((g, i) => {
		w += (g.advanceWidth ?? 0) * scale + tracking;
		if (i < glyphs.length - 1)
			w += font.getKerningValue(g, glyphs[i + 1]) * scale;
	});
	return w - (glyphs.length ? tracking : 0);
}

/** Each distinct glyph is outlined once into <defs>; runs place it with <use>. */
const glyphDefs = new Map<string, { id: string; d: string }>();
const fontKey = new Map<Font, string>();

/** One outlined run of text: a group of <use> references to shared glyphs. */
function text(
	font: Font,
	value: string,
	x: number,
	y: number,
	size: number,
	fill: string,
	tracking = 0,
	extra = "",
) {
	const glyphs = font.stringToGlyphs(value);
	const scale = size / font.unitsPerEm;
	if (!fontKey.has(font)) fontKey.set(font, `f${fontKey.size}`);
	let cx = x;
	let uses = "";
	glyphs.forEach((g, i) => {
		const key = `${fontKey.get(font)}-${size}-${g.index}`;
		let def = glyphDefs.get(key);
		if (!def) {
			def = {
				id: `g${glyphDefs.size}`,
				d: g.getPath(0, 0, size).toPathData(2),
			};
			glyphDefs.set(key, def);
		}
		if (def.d) uses += `<use href="#${def.id}" x="${cx.toFixed(2)}" y="${y}"/>`;
		cx += (g.advanceWidth ?? 0) * scale + tracking;
		if (i < glyphs.length - 1)
			cx += font.getKerningValue(g, glyphs[i + 1]) * scale;
	});
	return `<g fill="${fill}"${extra}>${uses}</g>`;
}

function hero(p: Palette, id: string) {
	glyphDefs.clear();
	const right = 912;
	let bg = "";
	QUESTIONS.forEach(([q, route], i) => {
		const y = 40 + i * 38;
		const routeW = measure(mono, route, 13);
		const arrow = "   →   ";
		const arrowW = measure(mono, arrow, 13);
		const ask = `> ${q}`;
		const askX = right - routeW - arrowW - measure(mono, ask, 13);
		bg += text(mono, ask, askX, y, 13, p.faint, 0, ' fill-opacity=".7"');
		bg += text(
			mono,
			arrow,
			right - routeW - arrowW,
			y,
			13,
			p.faint,
			0,
			' fill-opacity=".7"',
		);
		bg += text(mono, route, right - routeW, y, 13, p.pri);
	});

	let fg = "";
	const s = 26 / 36;
	fg += `<g transform="translate(${(56 - 6 * s).toFixed(2)} ${(44 - 9 * s).toFixed(2)}) scale(${s.toFixed(4)})"><polygon points="8,23 28,15 40,23 20,31" fill="${p.ink}" fill-opacity=".24"/><polygon points="8,19 28,11 40,19 20,27" fill="${p.pri}"/></g>`;
	fg += text(sansMed, "secondlayer", 90, 57, 17, p.ink, -0.2);

	const size = 58;
	const tracking = -size * 0.025;
	fg += text(sansMed, "Instant data for", 56, 152, size, p.ink, tracking);
	const beat = "apps on Bitcoin.";
	const beatW = measure(sansMed, beat, size, tracking);
	fg += `<rect x="50" y="${(216 - size * 0.86).toFixed(1)}" width="${(beatW + 12).toFixed(1)}" height="${(size * 1.1).toFixed(1)}" rx="3" fill="${p.ink}"/>`;
	fg += text(sansMed, beat, 56, 216, size, p.paper, tracking);
	fg += text(
		sans,
		"Every Stacks block, decoded from genesis and delivered at tip.",
		56,
		266,
		17,
		p.sub,
	);

	FACTS.forEach(([n, label], i) => {
		const x = 56 + i * 196;
		fg += text(sansMed, n, x, 314, 28, p.ink, -0.6);
		fg += text(mono, label, x, 338, 12, p.faint);
	});

	const defs = `<defs><linearGradient id="h-${id}" gradientUnits="userSpaceOnUse" x1="440" y1="0" x2="720" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="v-${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}"><stop offset="0" stop-color="#000"/><stop offset=".2" stop-color="#fff"/><stop offset=".62" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><mask id="mh-${id}"><rect width="${W}" height="${H}" fill="url(#h-${id})"/></mask><mask id="mv-${id}"><rect width="${W}" height="${H}" fill="url(#v-${id})"/></mask>${[...glyphDefs.values()].map((g) => `<path id="${g.id}" d="${g.d}"/>`).join("")}</defs>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Secondlayer: Instant data for apps on Bitcoin.">${defs}<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${p.paper}" stroke="${p.line}"/><g mask="url(#mv-${id})"><g mask="url(#mh-${id})" opacity=".75">${bg}</g></g>${fg}</svg>\n`;
}

for (const [name, palette] of Object.entries(PALETTES)) {
	const file = join(OUT_DIR, `hero-${name}.svg`);
	const svg = hero(palette, name[0]);
	await writeFile(file, svg);
	console.log(
		`✓ .github/assets/hero-${name}.svg  (${svg.length.toLocaleString()} bytes)`,
	);
}
