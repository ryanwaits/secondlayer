/**
 * Writes plain-language search queries ("phrasings") for every docs section and
 * page into src/generated/docs-phrasings.json. The docs search ranks them as
 * keywords in the browser, so a paraphrase finds its section with no model
 * call at search time.
 *
 * Only sections whose content hash changed are sent to the model, so a rerun
 * after editing one page costs one small request.
 *
 * Usage (from apps/web): AI_GATEWAY_API_KEY=… bun run docs:phrasings
 * Override the model with DOCS_PHRASINGS_MODEL.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateObject, jsonSchema } from "ai";
import {
	docsHeadingIndex,
	docsPages,
	readDocsMarkdown,
} from "../src/lib/docs-source";

const MODEL = process.env.DOCS_PHRASINGS_MODEL || "anthropic/claude-haiku-5.5";
const BATCH = 10;
const CONCURRENCY = 4;
const MIN_PHRASINGS = 3;
const MAX_PHRASINGS = 10;
const OUT = join(process.cwd(), "src", "generated", "docs-phrasings.json");

type Section = {
	id: string;
	pageTitle: string;
	title: string;
	summary: string;
	hash: string;
};
type Entry = { hash: string; phrasings: string[] };
type Store = Record<string, Entry>;

/** Prose only: no fences, tables, quotes, tags, link targets or backticks. */
function prose(markdown: string): string {
	let fence = false;
	const keep: string[] = [];
	for (const line of markdown.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence || /^\s*[|>]/.test(line)) continue;
		keep.push(line);
	}
	return keep
		.join("\n")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/[`*_]/g, "")
		.replace(/[ \t]+/g, " ")
		.trim();
}

function firstSentence(text: string): string {
	const para = text.split(/\n\s*\n/).find((p) => p.trim()) ?? "";
	const flat = para.replace(/\s+/g, " ").trim();
	// A fragment like "Read-only." says nothing; keep going to a second sentence.
	let end = -1;
	for (const m of flat.matchAll(/[.!?](\s|$)/g)) {
		end = m.index + 1;
		if (end >= 40) break;
	}
	return (end > 0 ? flat.slice(0, end) : flat).slice(0, 160);
}

const hashOf = (title: string, summary: string, body: string) =>
	createHash("sha256")
		.update(`${title}\n${summary}\n${body.slice(0, 600)}`)
		.digest("hex")
		.slice(0, 16);

async function loadSections(): Promise<Section[]> {
	const index = await docsHeadingIndex();
	const out: Section[] = [];
	for (const page of docsPages()) {
		const md = await readDocsMarkdown(page.href, { setup: false });
		if (!md) continue;
		// Split at every heading; the first chunk is the page's own lede.
		const chunks = md.split(/^(?=#{1,3} )/m);
		const lede = prose(chunks[0].replace(/^# .*\n?/, ""));
		const pageBody = prose(
			chunks[0].replace(/^# .*\n?/, "") || (chunks[1] ?? ""),
		);
		out.push({
			id: page.href,
			pageTitle: page.group,
			title: page.title,
			summary: firstSentence(lede || pageBody),
			hash: hashOf(page.title, firstSentence(lede || pageBody), lede),
		});
		const wanted = index.filter((h) => h.href === page.href);
		const byTitle = new Map<string, typeof wanted>();
		for (const h of wanted) {
			const q = byTitle.get(h.title) ?? [];
			q.push(h);
			byTitle.set(h.title, q);
		}
		for (const chunk of chunks) {
			const head = /^#{2,3} (.+)$/m.exec(chunk.split("\n")[0]);
			if (!head) continue;
			const title = prose(head[1]);
			const entry = byTitle.get(title)?.shift();
			if (!entry) continue;
			const body = prose(chunk.split("\n").slice(1).join("\n"));
			const summary = firstSentence(body);
			out.push({
				id: `${entry.href}#${entry.anchor}`,
				pageTitle: page.title,
				title: entry.title,
				summary,
				hash: hashOf(entry.title, summary, body),
			});
		}
	}
	return out;
}

const schema = jsonSchema<{
	items: { id: string; phrasings: string[] }[];
}>({
	type: "object",
	properties: {
		items: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string" },
					phrasings: { type: "array", items: { type: "string" } },
				},
				required: ["id", "phrasings"],
				additionalProperties: false,
			},
		},
	},
	required: ["items"],
	additionalProperties: false,
});

function prompt(batch: Section[]): string {
	const list = batch
		.map(
			(s) =>
				`id: ${s.id}\nSection: ${s.pageTitle} › ${s.title}\nSummary: ${s.summary}`,
		)
		.join("\n\n");
	return [
		"For each docs section below, write 6 to 10 short search queries (3–9 words, lowercase, no punctuation) a developer would type when that section is the answer.",
		"Mix questions, symptoms and tasks. Never repeat the title verbatim.",
		"Return one item per section, keyed by its exact id.",
		"",
		list,
	].join("\n");
}

/** Lowercase, deduped, 3–80 chars, no code or URLs; null when too few survive. */
function clean(raw: string[], title: string): string[] | null {
	const seen = new Set<string>();
	for (const r of raw) {
		const p = r.trim().toLowerCase().replace(/\s+/g, " ");
		if (p.length < 3 || p.length > 80) continue;
		if (/[`]|https?:|:\/\//.test(p)) continue;
		if (p === title.toLowerCase()) continue;
		seen.add(p);
		if (seen.size === MAX_PHRASINGS) break;
	}
	return seen.size >= MIN_PHRASINGS ? [...seen] : null;
}

let calls = 0;

async function generate(batch: Section[], store: Store): Promise<Section[]> {
	calls++;
	let items: { id: string; phrasings: string[] }[] = [];
	try {
		const result = await generateObject({
			model: MODEL,
			schema,
			prompt: prompt(batch),
			maxRetries: 1,
		});
		items = result.object.items;
	} catch (err) {
		console.error(
			`batch of ${batch.length} failed: ${err instanceof Error ? err.message : "unknown error"}`,
		);
		return batch;
	}
	const byId = new Map(items.map((i) => [i.id, i.phrasings]));
	const failed: Section[] = [];
	for (const s of batch) {
		const phrasings = clean(byId.get(s.id) ?? [], s.title);
		if (phrasings) store[s.id] = { hash: s.hash, phrasings };
		else failed.push(s);
	}
	return failed;
}

async function pool<T>(items: T[], run: (item: T) => Promise<void>) {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
			while (next < items.length) await run(items[next++]);
		}),
	);
}

async function main() {
	if (!process.env.AI_GATEWAY_API_KEY) {
		console.error("AI_GATEWAY_API_KEY is not set; nothing generated.");
		process.exit(1);
	}
	const sections = await loadSections();
	const existing: Store = await readFile(OUT, "utf8")
		.then((t) => JSON.parse(t) as Store)
		.catch(() => ({}));
	const live = new Set(sections.map((s) => s.id));
	const store: Store = {};
	for (const [id, e] of Object.entries(existing))
		if (live.has(id)) store[id] = e;
	const changed = sections.filter((s) => store[s.id]?.hash !== s.hash);
	console.log(
		`${sections.length} sections, ${changed.length} changed, model ${MODEL}`,
	);

	const batches: Section[][] = [];
	for (let i = 0; i < changed.length; i += BATCH)
		batches.push(changed.slice(i, i + BATCH));
	let failed: Section[] = [];
	await pool(batches, async (b) => {
		failed.push(...(await generate(b, store)));
	});
	// One retry pass for whatever the first pass missed.
	if (failed.length) {
		const retry = failed;
		failed = [];
		const again: Section[][] = [];
		for (let i = 0; i < retry.length; i += BATCH)
			again.push(retry.slice(i, i + BATCH));
		await pool(again, async (b) => {
			failed.push(...(await generate(b, store)));
		});
	}

	const sorted = Object.fromEntries(
		Object.entries(store).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
	);
	await writeFile(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
	console.log(
		`${changed.length - failed.length} written, ${failed.length} failed, ${calls} model calls`,
	);
	if (failed.length) {
		console.error(`failed: ${failed.map((s) => s.id).join(", ")}`);
		process.exit(1);
	}
}

await main();
