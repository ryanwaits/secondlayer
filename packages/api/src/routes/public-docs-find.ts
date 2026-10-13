/**
 * Docs search finder: snaps a weak search to the docs section that covers it.
 *
 *   POST /api/public/docs-find  { q }  →  { match: { href, anchor?, title, confidence } | null }
 *
 * Mounted only in platform mode. The browser calls it directly so the rate
 * limit sees the visitor's IP. A shared classifier call (jev) picks a page,
 * then a section of that page, from the published section list; it only ever
 * chooses among options, so the route cannot be used as a general model. The
 * query is never echoed or logged. Every failure answers `{ match: null }`
 * and the search stays text-only.
 */

import { logger } from "@secondlayer/shared";
import { classify } from "@secondlayer/shared/classify";
import type { Question } from "@secondlayer/shared/classify";
import { RateLimitError } from "@secondlayer/shared/errors";
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
const CLASSIFY_TIMEOUT_MS = 2500;
const SECTIONS_TTL_MS = 600_000;
const SECTIONS_FETCH_TIMEOUT_MS = 3000;
const ANSWER_TTL_MS = 3_600_000;
const ANSWER_CACHE_MAX = 500;
const DEFAULT_SECTIONS_URL = "https://www.secondlayer.tools/docs/sections.json";

/** The classifier takes 2-255 options and 64 questions; one slot is the escape. */
const MAX_SECTIONS_PER_PAGE = 254;
const MAX_PAGES = 63;
/** Mirrors the shared classifier's question-id rule. */
const QUESTION_ID = /^[A-Za-z0-9_.-]{1,100}$/;
const WHOLE_PAGE = "_page";
const NONE = "none";

export type SectionList = {
	pages: { href: string; title: string; lede: string }[];
	sections: { href: string; anchor: string; title: string; summary: string }[];
};

export type DocsMatch = {
	href: string;
	anchor?: string;
	title: string;
	confidence: number;
};

type Outcome = "hit" | "none" | "null";

export type Catalog = {
	questions: Record<string, Question>;
	pageIds: Map<string, SectionList["pages"][number]>;
	sectionsByPage: Map<string, Map<string, SectionList["sections"][number]>>;
};

/** `/docs/self-host/production` → `self-host.production`; `/docs` → `docs`. */
export function pageQuestionId(href: string): string {
	const rel = href.replace(/^\/docs\/?/, "");
	return rel ? rel.replace(/\//g, ".") : "docs";
}

const describe = (title: string, text: string) =>
	text ? `${title}: ${text}` : title;

/** The page question plus one section question per page that has sections. */
export function buildCatalog(list: SectionList): Catalog {
	const pageIds = new Map<string, SectionList["pages"][number]>();
	for (const page of list.pages) {
		const id = pageQuestionId(page.href);
		if (!QUESTION_ID.test(`s.${id}`) || pageIds.has(id)) continue;
		if (pageIds.size >= MAX_PAGES) {
			logger.warn("docs_find.pages_capped", { max: MAX_PAGES });
			break;
		}
		pageIds.set(id, page);
	}

	const questions: Record<string, Question> = {};
	const sectionsByPage = new Map<
		string,
		Map<string, SectionList["sections"][number]>
	>();
	const pageCriteria: Record<string, string> = {};
	for (const [id, page] of pageIds) {
		pageCriteria[id] = describe(page.title, page.lede);
		const own = list.sections.filter((s) => s.href === page.href);
		if (own.length === 0) continue;
		if (own.length > MAX_SECTIONS_PER_PAGE) {
			logger.warn("docs_find.sections_capped", {
				page: id,
				max: MAX_SECTIONS_PER_PAGE,
			});
		}
		const kept = new Map<string, SectionList["sections"][number]>();
		const criteria: Record<string, string> = {
			[WHOLE_PAGE]: "The page as a whole.",
		};
		for (const s of own.slice(0, MAX_SECTIONS_PER_PAGE)) {
			if (s.anchor === WHOLE_PAGE || kept.has(s.anchor)) continue;
			kept.set(s.anchor, s);
			criteria[s.anchor] = describe(s.title, s.summary);
		}
		sectionsByPage.set(id, kept);
		questions[`s.${id}`] = {
			type: "choice",
			instructions:
				"A developer typed this into the docs search. Pick the section where the answer is.",
			criteria,
		};
	}
	pageCriteria[NONE] = "The question is not about these docs.";
	questions.page = {
		type: "choice",
		instructions:
			"A developer typed this into the docs search. Pick the page where the answer is.",
		criteria: pageCriteria,
	};
	return { questions, pageIds, sectionsByPage };
}

type ClassifyFn = (input: {
	state: string;
	questions: Record<string, Question>;
	timeoutMs: number;
}) => Promise<{
	answers: Record<
		string,
		{ type: string; choice?: string; confidence?: number }
	>;
} | null>;

/** Reads the page answer, then that page's section answer, into one match. */
export function pickMatch(
	catalog: Catalog,
	answers: NonNullable<Awaited<ReturnType<ClassifyFn>>>["answers"],
): DocsMatch | null {
	const pageAnswer = answers.page;
	if (
		!pageAnswer ||
		pageAnswer.type !== "choice" ||
		pageAnswer.choice === undefined ||
		pageAnswer.choice === NONE
	)
		return null;
	const page = catalog.pageIds.get(pageAnswer.choice);
	if (!page) return null;
	const pageConfidence = pageAnswer.confidence ?? 0;
	const sectionAnswer = answers[`s.${pageAnswer.choice}`];
	const pageMatch: DocsMatch = {
		href: page.href,
		title: page.title,
		confidence: round(pageConfidence),
	};
	if (
		!sectionAnswer ||
		sectionAnswer.type !== "choice" ||
		sectionAnswer.choice === undefined ||
		sectionAnswer.choice === WHOLE_PAGE
	)
		return pageMatch;
	const section = catalog.sectionsByPage
		.get(pageAnswer.choice)
		?.get(sectionAnswer.choice);
	if (!section) return pageMatch;
	return {
		href: section.href,
		anchor: section.anchor,
		title: section.title,
		confidence: round(Math.min(pageConfidence, sectionAnswer.confidence ?? 0)),
	};
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Lowercased, whitespace-collapsed: the cache key for a query. */
const normalize = (q: string) => q.toLowerCase().replace(/\s+/g, " ");

function bucket(match: DocsMatch | null): string {
	if (!match) return "none";
	if (match.confidence >= 0.85) return "high";
	return match.confidence >= 0.5 ? "mid" : "low";
}

function isSectionList(value: unknown): value is SectionList {
	const v = value as SectionList | null;
	return !!v && Array.isArray(v.pages) && Array.isArray(v.sections);
}

/** Section list from a fixed URL, cached 10 min, last good copy kept on failure. */
export function createSectionSource(opts?: {
	fetchImpl?: typeof fetch;
	now?: () => number;
}) {
	const doFetch = opts?.fetchImpl ?? fetch;
	const now = opts?.now ?? Date.now;
	let cached: { at: number; list: SectionList; catalog: Catalog } | null = null;
	let inflight: Promise<void> | null = null;

	async function refresh() {
		const url = process.env.DOCS_SECTIONS_URL?.trim() || DEFAULT_SECTIONS_URL;
		try {
			const res = await doFetch(url, {
				signal: AbortSignal.timeout(SECTIONS_FETCH_TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`status ${res.status}`);
			const list: unknown = await res.json();
			if (!isSectionList(list)) throw new Error("unexpected shape");
			cached = { at: now(), list, catalog: buildCatalog(list) };
		} catch (err) {
			logger.warn("docs_find.sections_unavailable", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return async function get(): Promise<Catalog | null> {
		if (!cached || now() - cached.at > SECTIONS_TTL_MS) {
			inflight ??= refresh().finally(() => {
				inflight = null;
			});
			await inflight;
		}
		return cached?.catalog ?? null;
	};
}

export function createDocsFindRouter(opts?: {
	rateLimitStore?: RateLimitStore;
	catalog?: () => Promise<Catalog | null>;
	classify?: ClassifyFn;
	now?: () => number;
}) {
	const app = new Hono();
	const getCatalog = opts?.catalog ?? createSectionSource();
	const now = opts?.now ?? Date.now;
	const run: ClassifyFn =
		opts?.classify ?? ((input) => classify(input) as ReturnType<ClassifyFn>);
	const answers = new Map<string, { at: number; match: DocsMatch | null }>();

	function remember(key: string, match: DocsMatch | null) {
		answers.delete(key);
		answers.set(key, { at: now(), match });
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
			remember(key, hit.match);
			return c.json({ match: hit.match });
		}

		let match: DocsMatch | null = null;
		let outcome: Outcome = "null";
		const catalog = await getCatalog();
		if (catalog) {
			const result = await run({
				state: q,
				questions: catalog.questions,
				timeoutMs: CLASSIFY_TIMEOUT_MS,
			});
			if (result) {
				match = pickMatch(catalog, result.answers);
				outcome = match ? "hit" : "none";
			}
		}
		if (outcome !== "null") remember(key, match);
		logger.info("docs_find", {
			ms: now() - started,
			outcome,
			confidence: bucket(match),
		});
		return c.json({ match });
	});

	return app;
}

export default createDocsFindRouter();
