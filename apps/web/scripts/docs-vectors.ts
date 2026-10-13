/**
 * Embeds every docs search candidate into src/generated/docs-vectors.json. The
 * API's finder route compares a query embedding to these vectors, so the
 * browser can re-rank a weak text search by meaning.
 *
 * Vectors are cut to 256 dims, renormalized, and stored as int8 (one scale per
 * vector, folded so the dequantized vector has unit length). Only sections
 * whose text hash changed are sent to the model, so a rerun after editing one
 * page costs one small request and an untouched rerun costs none.
 *
 * Usage (from apps/web): AI_GATEWAY_API_KEY=… bun run docs:vectors
 * Run `bun run docs:phrasings` first; phrasings are part of the embedded text.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { embedMany } from "ai";
import type { DocsSearchDoc } from "../src/lib/docs-bm25";
import { docsSearchDocs } from "../src/lib/docs-source";

export const MODEL = "cohere/embed-v5.0-fast";
export const DIMS = 256;
const BATCH = 96;
const OUT = join(process.cwd(), "src", "generated", "docs-vectors.json");

export type VectorItem = { id: string; hash: string; scale: number; q: string };
export type VectorFile = { model: string; dims: number; items: VectorItem[] };

/** What a section is embedded as: where it lives, what it is, what it says. */
export function embedText(d: DocsSearchDoc): string {
	const head = d.page ? `${d.page} › ${d.title}` : d.title;
	return [`${head}.`, d.body, d.phrasings.join(". ")]
		.filter(Boolean)
		.join(" ")
		.trim();
}

export const textHash = (text: string) =>
	createHash("sha256")
		.update(`${MODEL}\n${DIMS}\n${text}`)
		.digest("hex")
		.slice(0, 16);

/** First 256 dims, unit length, int8 with a scale that restores unit length. */
export function quantize(vector: number[]): { scale: number; q: string } {
	const cut = vector.slice(0, DIMS);
	const norm = Math.hypot(...cut) || 1;
	const unit = cut.map((x) => x / norm);
	const peak = Math.max(...unit.map(Math.abs)) || 1;
	const ints = Int8Array.from(unit, (x) => Math.round((x / peak) * 127));
	const length = Math.hypot(...Array.from(ints, (i) => (i * peak) / 127)) || 1;
	return {
		scale: peak / 127 / length,
		q: Buffer.from(ints.buffer).toString("base64"),
	};
}

async function main() {
	if (!process.env.AI_GATEWAY_API_KEY) {
		console.error("AI_GATEWAY_API_KEY is not set; nothing embedded.");
		process.exit(1);
	}
	const docs = await docsSearchDocs();
	const existing: VectorFile | null = await readFile(OUT, "utf8")
		.then((t) => JSON.parse(t) as VectorFile)
		.catch(() => null);
	const reusable =
		existing?.model === MODEL && existing.dims === DIMS
			? new Map(existing.items.map((i) => [i.id, i]))
			: new Map<string, VectorItem>();

	const items = new Map<string, VectorItem>();
	const stale: { doc: DocsSearchDoc; text: string; hash: string }[] = [];
	for (const doc of docs) {
		const text = embedText(doc);
		const hash = textHash(text);
		const kept = reusable.get(doc.id);
		if (kept && kept.hash === hash) items.set(doc.id, kept);
		else stale.push({ doc, text, hash });
	}
	console.log(
		`${docs.length} sections, ${stale.length} changed, model ${MODEL}`,
	);

	let calls = 0;
	for (let i = 0; i < stale.length; i += BATCH) {
		const batch = stale.slice(i, i + BATCH);
		calls++;
		const { embeddings } = await embedMany({
			model: MODEL,
			values: batch.map((b) => b.text),
			maxRetries: 1,
		});
		batch.forEach((b, j) => {
			items.set(b.doc.id, {
				id: b.doc.id,
				hash: b.hash,
				...quantize(embeddings[j]),
			});
		});
	}

	const file: VectorFile = {
		model: MODEL,
		dims: DIMS,
		items: [...items.values()].sort((a, b) =>
			a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
		),
	};
	await writeFile(OUT, `${JSON.stringify(file)}\n`);
	console.log(`${file.items.length} written, ${calls} model calls`);
}

if (import.meta.main) await main();
