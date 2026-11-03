/**
 * Which docs rows get a "New" chip, derived from git history alone. A docs
 * edit proves nothing: a refactor, a fix or a reflow touches old pages all the
 * time. What does prove something is shipped code naming a term for the first
 * time, so the rule reads `feat` commit subjects, not the docs themselves.
 *
 * A launch: a heading added to a docs page whose terms shipped code suddenly
 * names. Within 30 days up to the heading's date, at least MIN_FEATS `feat`
 * subjects name the term across at least MIN_SCOPES distinct scopes (web, docs,
 * ci, release and no scope don't count), and at most MAX_BEFORE subjects named
 * it earlier. One launch gets one row: the page that mentions the term most.
 *
 * A new page: its first add (renames followed) is recent, adds enough lines,
 * is not mostly lines moved from other docs pages, and still exists. Each group
 * (first path segment under docs/) keeps its newest MAX_NEW_PAGES_PER_GROUP.
 *
 * Pure and free of Node imports; `scripts/docs-new.ts` reads the history, and
 * the sidebar's `isFresh` expires rows at runtime. Constants were checked by
 * replay at several dates: change one only after rerunning `--as-of`.
 */

import { NEW_DAYS } from "./docs-new.mjs";

export const MIN_FEATS = 5;
export const MIN_SCOPES = 3;
export const MAX_BEFORE = 1;
export const MIN_PAGE_LINES = 40;
export const MAX_MOVED = 0.5;
export const MAX_NEW_PAGES_PER_GROUP = 2;

const DAY_MS = 86_400_000;

/** Scopes that say where a commit landed, not which feature it is. */
const GENERIC_SCOPES = new Set(["web", "docs", "ci", "release", ""]);

/** @param {string} word */
const stem = (word) =>
	word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;

/** Ordinary words plus the product's own nouns, compared after stemming. */
const STOP = new Set(
	(
		"a an and are as at be by can do does each for from has have how in into is it its of on or that the " +
		"this to was what when where which why will with you your all any new get use using every one two " +
		"read reads make run set up out own over check about other ways next not yet only more most " +
		"index stream subgraph webhook archive verify mcp sdk cli api doc key"
	)
		.split(" ")
		.map(stem),
);

/**
 * `YYYY-MM-DD` shifted by whole days.
 * @param {string} date
 * @param {number} days
 */
const shift = (date, days) =>
	new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

/** @param {string} term */
export const termPattern = (term) =>
	new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`);

/**
 * The terms a heading can launch: its words, stemmed, minus stop words.
 * @param {string} text
 * @returns {string[]}
 */
export function headingTerms(text) {
	const words = text.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [];
	return [
		...new Set(
			words
				.filter((word) => word.length > 2 && !STOP.has(stem(word)))
				.map(stem),
		),
	];
}

/**
 * Whether shipped code suddenly names `term` at `date`.
 * @param {string} term
 * @param {string} date YYYY-MM-DD, the day the heading was added
 * @param {{ date: string, scope: string, subject: string }[]} feats
 */
export function isLaunch(term, date, feats) {
	const needle = termPattern(term);
	const start = shift(date, -NEW_DAYS);
	let recent = 0;
	let before = 0;
	const scopes = new Set();
	for (const feat of feats) {
		if (feat.date > date || !needle.test(feat.subject.toLowerCase())) continue;
		if (feat.date < start) {
			before++;
		} else {
			recent++;
			const scope = feat.scope.toLowerCase();
			if (!GENERIC_SCOPES.has(scope)) scopes.add(scope);
		}
	}
	return (
		recent >= MIN_FEATS && scopes.size >= MIN_SCOPES && before <= MAX_BEFORE
	);
}

/**
 * @param {{
 *   feats: { date: string, scope: string, subject: string }[],
 *   headings: { date: string, route: string, text: string }[],
 *   pages: { date: string, at: number, route: string, lines: number, moved: number }[],
 *   exists: (route: string) => boolean,
 *   mentions: (route: string, term: string) => number,
 * }} history already limited to commits on or before asOf
 * @param {string} asOf YYYY-MM-DD
 * @returns {Record<string, string>} route -> date
 */
export function newRows(history, asOf) {
	const { feats, headings, pages, exists, mentions } = history;
	const start = shift(asOf, -NEW_DAYS);
	const inWindow = (/** @type {string} */ date) =>
		date >= start && date <= asOf;
	const skipped = (/** @type {string} */ route) =>
		route.startsWith("/docs/changelog");

	/** @type {Map<string, { date: string, route: string }[]>} */
	const launches = new Map();
	for (const heading of headings) {
		if (!inWindow(heading.date) || skipped(heading.route)) continue;
		if (!exists(heading.route)) continue;
		for (const term of headingTerms(heading.text)) {
			if (!isLaunch(term, heading.date, feats)) continue;
			const hits = launches.get(term) ?? [];
			hits.push({ date: heading.date, route: heading.route });
			launches.set(term, hits);
		}
	}

	/** @type {Record<string, string>} */
	const rows = {};
	for (const [term, hits] of launches) {
		let best = hits[0];
		let bestCount = mentions(best.route, term);
		for (const hit of hits.slice(1)) {
			const count = mentions(hit.route, term);
			if (count > bestCount) [best, bestCount] = [hit, count];
		}
		const date = hits.reduce((a, hit) => (hit.date > a ? hit.date : a), "");
		if (!rows[best.route] || date > rows[best.route]) rows[best.route] = date;
	}

	/** @type {Map<string, typeof pages>} */
	const groups = new Map();
	for (const page of pages) {
		if (!inWindow(page.date) || skipped(page.route) || !exists(page.route))
			continue;
		if (page.lines < MIN_PAGE_LINES || page.moved >= MAX_MOVED) continue;
		const path = page.route.replace(/^\/docs\/?/, "");
		const group = path.includes("/") ? path.split("/")[0] : "top";
		groups.set(group, [...(groups.get(group) ?? []), page]);
	}
	for (const group of groups.values()) {
		group.sort((a, b) => b.at - a.at || a.route.localeCompare(b.route));
		for (const page of group.slice(0, MAX_NEW_PAGES_PER_GROUP)) {
			rows[page.route] ??= page.date;
		}
	}

	return Object.fromEntries(
		Object.entries(rows).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
	);
}
