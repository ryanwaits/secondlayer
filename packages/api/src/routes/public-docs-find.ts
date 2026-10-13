/**
 * Docs search finder: the sections nearest in meaning to a query.
 *
 *   POST /api/public/docs-find  { q }  →  { results: [{ id, cos }] }   (top 30)
 *
 * Mounted only in platform mode. The browser calls it directly so the rate
 * limit sees the visitor's IP. The route embeds the query with the model the
 * published section vectors were built with and returns cosines against them;
 * the browser fuses that with its own text scores. It never generates text, so
 * it cannot be used as a general model. The query is never echoed or logged.
 * Every failure answers `{ results: [] }` and the search stays text-only.
 */

import { logger } from "@secondlayer/shared";
import { RateLimitError } from "@secondlayer/shared/errors";
import { embed } from "ai";
import { Hono } from "hono";
import { getClientIp } from "../auth/http.ts";
import {
	type RateLimitStore,
	getRateLimitStore,
} from "../auth/rate-limit-store.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const MIN_Q = 3;
const MAX_Q = 200;
const MINUTE_LIMIT = 30;
const DAY_LIMIT = 400;
const DAY_MS = 86_400_000;
const EMBED_TIMEOUT_MS = 2500;
const VECTORS_TTL_MS = 600_000;
const VECTORS_FETCH_TIMEOUT_MS = 3000;
const ANSWER_TTL_MS = 3_600_000;
const ANSWER_CACHE_MAX = 500;
const TOP_K = 30;
const DEFAULT_VECTORS_URL = "https://www.secondlayer.tools/docs/vectors.json";

/** The file `bun run docs:vectors` writes, served at /docs/vectors.json. */
export type VectorFile = {
	model: string;
	dims: number;
	items: { id: string; hash: string; scale: number; q: string }[];
};

export type Nearest = { id: string; cos: number };

/** The vectors decoded once: row `i` of `matrix` belongs to `ids[i]`. */
export type VectorIndex = {
	model: string;
	dims: number;
	ids: string[];
	matrix: Float32Array;
};

function isVectorFile(value: unknown): value is VectorFile {
	const v = value as VectorFile | null;
	return (
		!!v &&
		typeof v.model === "string" &&
		Number.isInteger(v.dims) &&
		v.dims > 0 &&
		Array.isArray(v.items)
	);
}

/** Dequantizes int8 rows; rows of the wrong length are dropped. */
export function decodeVectors(file: VectorFile): VectorIndex {
	const rows = file.items.filter(
		(i) =>
			typeof i.id === "string" &&
			typeof i.scale === "number" &&
			typeof i.q === "string" &&
			Buffer.from(i.q, "base64").length === file.dims,
	);
	const matrix = new Float32Array(rows.length * file.dims);
	rows.forEach((row, r) => {
		const bytes = new Int8Array(Buffer.from(row.q, "base64"));
		for (let d = 0; d < file.dims; d++) {
			matrix[r * file.dims + d] = bytes[d] * row.scale;
		}
	});
	return {
		model: file.model,
		dims: file.dims,
		ids: rows.map((r) => r.id),
		matrix,
	};
}

/** First `dims` values, scaled to unit length. */
export function unitPrefix(vector: number[], dims: number): Float32Array {
	const out = Float32Array.from(vector.slice(0, dims));
	const norm = Math.hypot(...out) || 1;
	for (let i = 0; i < out.length; i++) out[i] /= norm;
	return out;
}

/** Cosine of the query against every row (rows are unit length), best `k` first. */
export function nearest(
	index: VectorIndex,
	query: Float32Array,
	k: number,
): Nearest[] {
	const { dims, matrix, ids } = index;
	const scored: Nearest[] = [];
	for (let r = 0; r < ids.length; r++) {
		let dot = 0;
		for (let d = 0; d < dims; d++) dot += matrix[r * dims + d] * query[d];
		scored.push({ id: ids[r], cos: Math.round(dot * 10_000) / 10_000 });
	}
	return scored.sort((a, b) => b.cos - a.cos).slice(0, k);
}

/** Lowercased, whitespace-collapsed: the cache key for a query. */
const normalize = (q: string) => q.toLowerCase().replace(/\s+/g, " ");

/** Section vectors from a fixed URL, cached 10 min, last good copy kept on failure. */
export function createVectorSource(opts?: {
	fetchImpl?: typeof fetch;
	now?: () => number;
}) {
	const doFetch = opts?.fetchImpl ?? fetch;
	const now = opts?.now ?? Date.now;
	let cached: { at: number; index: VectorIndex } | null = null;
	let inflight: Promise<void> | null = null;

	async function refresh() {
		const url = process.env.DOCS_VECTORS_URL?.trim() || DEFAULT_VECTORS_URL;
		try {
			const res = await doFetch(url, {
				signal: AbortSignal.timeout(VECTORS_FETCH_TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`status ${res.status}`);
			const file: unknown = await res.json();
			if (!isVectorFile(file)) throw new Error("unexpected shape");
			cached = { at: now(), index: decodeVectors(file) };
		} catch (err) {
			logger.warn("docs_find.vectors_unavailable", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return async function get(): Promise<VectorIndex | null> {
		if (!cached || now() - cached.at > VECTORS_TTL_MS) {
			inflight ??= refresh().finally(() => {
				inflight = null;
			});
			await inflight;
		}
		return cached?.index ?? null;
	};
}

export type EmbedQuery = (input: {
	model: string;
	value: string;
	signal: AbortSignal;
}) => Promise<number[]>;

const embedViaGateway: EmbedQuery = async ({ model, value, signal }) =>
	(await embed({ model, value, abortSignal: signal, maxRetries: 0 })).embedding;

export function createDocsFindRouter(opts?: {
	rateLimitStore?: RateLimitStore;
	vectors?: () => Promise<VectorIndex | null>;
	embedQuery?: EmbedQuery;
	now?: () => number;
}) {
	const app = new Hono();
	const getVectors = opts?.vectors ?? createVectorSource();
	const now = opts?.now ?? Date.now;
	const embedQuery = opts?.embedQuery ?? embedViaGateway;
	const answers = new Map<string, { at: number; results: Nearest[] }>();

	function remember(key: string, results: Nearest[]) {
		answers.delete(key);
		answers.set(key, { at: now(), results });
		if (answers.size > ANSWER_CACHE_MAX) {
			const oldest = answers.keys().next().value;
			if (oldest !== undefined) answers.delete(oldest);
		}
	}

	app.post("/", async (c) => {
		const ip = getClientIp(c);
		const store = opts?.rateLimitStore ?? getRateLimitStore();
		for (const [key, limit, windowMs] of [
			[`docs-find:${ip}`, MINUTE_LIMIT, 60_000],
			[`docs-find-day:${ip}`, DAY_LIMIT, DAY_MS],
		] as const) {
			const result = await store.check(key, limit, windowMs, {
				failClosed: true,
			});
			if (!result.allowed) {
				c.header("Retry-After", String(result.retryAfter));
				throw new RateLimitError("Too many searches, try again shortly");
			}
		}

		const body = await c.req.json().catch(() => {
			throw new InvalidJSONError();
		});
		const raw = (body as { q?: unknown } | null)?.q;
		const q = typeof raw === "string" ? raw.trim() : "";
		if (q.length < MIN_Q || q.length > MAX_Q) {
			return c.json(
				{ error: `q must be text of ${MIN_Q}-${MAX_Q} characters` },
				400,
			);
		}

		const started = now();
		const key = normalize(q);
		const hit = answers.get(key);
		if (hit && started - hit.at < ANSWER_TTL_MS) {
			remember(key, hit.results);
			return c.json({ results: hit.results });
		}

		let results: Nearest[] = [];
		let outcome: "ok" | "no_vectors" | "embed_failed" = "no_vectors";
		const index = await getVectors();
		if (index) {
			try {
				const embedding = await embedQuery({
					model: index.model,
					value: q,
					signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
				});
				if (embedding.length < index.dims) throw new RangeError("short vector");
				results = nearest(index, unitPrefix(embedding, index.dims), TOP_K);
				outcome = "ok";
				remember(key, results);
			} catch (err) {
				outcome = "embed_failed";
				logger.warn("docs_find.embed_failed", {
					error: err instanceof Error ? err.name : "unknown",
				});
			}
		}
		logger.info("docs_find", { ms: now() - started, outcome });
		return c.json({ results });
	});

	return app;
}

export default createDocsFindRouter();
