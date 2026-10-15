/**
 * BM25F over the docs search index: pure, dependency-free, runs in the browser.
 * The index (`/docs/search-index.json`) is compiled at build time; postings are
 * built once on first use.
 */

export type DocsSearchDoc = {
	/** `docs:<href>` for a page, `docs:<href>#<anchor>` for a section or endpoint. */
	id: string;
	href: string;
	label: string;
	sub: string;
	kind: "page" | "section" | "endpoint" | "method";
	title: string;
	/** Parent page or group name. */
	page: string;
	/** Plain-language queries written per section at build time. */
	phrasings: string[];
	/** First two sentences under the heading; empty for endpoints. */
	body: string;
};

/** Generic English function words only; nothing domain-specific. */
const STOPWORDS = new Set(
	"a an the of to in on for and or is are was be my me i it its do does how what why when where which who with without from at by as this that these those can we you your our get got up out want about into over after before than then so if not no".split(
		" ",
	),
);

const SUFFIXES = ["ing", "ly", "ed", "er", "es", "s"];

const FIELD_WEIGHTS = { title: 3, phrasings: 2, page: 1, body: 1 } as const;
type Field = keyof typeof FIELD_WEIGHTS;
const FIELDS = Object.keys(FIELD_WEIGHTS) as Field[];

const K1 = 1.2;
const B = 0.75;
/** Top score must beat the runner-up by this ratio to count as a sure hit. */
const CONFIDENT_RATIO = 1.4;

/** Strip one suffix when the word keeps at least three characters. */
function stem(word: string): string {
	for (const suffix of SUFFIXES) {
		if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
			return word.slice(0, -suffix.length);
		}
	}
	return word;
}

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !STOPWORDS.has(w))
		.map(stem);
}

export type DocsSearchIndex = {
	ids: string[];
	/** Per doc, per field: term → count. */
	tf: Map<string, number>[][];
	/** Per doc, per field: token count. */
	len: number[][];
	avgLen: number[];
	/** Per doc: the stemmed tokens of its title, for exact and prefix matches. */
	titles: string[][];
	/** Term → docs containing it in any field. */
	postings: Map<string, number[]>;
	/** Per doc: what its score is multiplied by (see `LANE_KINDS`). */
	weight: number[];
	/** Term → docs of the main lane containing it; with `size`, what IDF is computed from. */
	df: Map<string, number>;
	/** Docs in the main lane. */
	size: number;
};

/**
 * SDK methods are a lane of their own. They are many, and a prose question
 * matches their summaries by accident ("get notified when sbtc is deposited"
 * is not a request for `sl.index.sbtc.deposits.list`), so their scores are
 * halved: a query that names one still wins its title tier, and otherwise
 * pages, sections and endpoints come first. They do not count toward IDF or
 * average field length either, so adding them never moves how those rank
 * against each other.
 */
const LANE_KINDS: Partial<Record<DocsSearchDoc["kind"], number>> = {
	method: 0.5,
};

export function buildIndex(docs: DocsSearchDoc[]): DocsSearchIndex {
	const tf: Map<string, number>[][] = [];
	const len: number[][] = [];
	const totals = FIELDS.map(() => 0);
	const postings = new Map<string, number[]>();
	const df = new Map<string, number>();
	const titles: string[][] = [];
	let size = 0;

	docs.forEach((doc, d) => {
		const text: Record<Field, string> = {
			title: doc.title,
			phrasings: doc.phrasings.join(" "),
			page: doc.page,
			body: doc.body,
		};
		const main = LANE_KINDS[doc.kind] === undefined;
		if (main) size++;
		const seen = new Set<string>();
		const counts: Map<string, number>[] = [];
		const lengths: number[] = [];
		FIELDS.forEach((field, f) => {
			const tokens = tokenize(text[field]);
			const m = new Map<string, number>();
			for (const t of tokens) {
				m.set(t, (m.get(t) ?? 0) + 1);
				seen.add(t);
			}
			counts.push(m);
			lengths.push(tokens.length);
			if (main) totals[f] += tokens.length;
		});
		titles.push(tokenize(doc.title));
		tf.push(counts);
		len.push(lengths);
		for (const t of seen) {
			const list = postings.get(t);
			if (list) list.push(d);
			else postings.set(t, [d]);
			if (main) df.set(t, (df.get(t) ?? 0) + 1);
		}
	});

	return {
		ids: docs.map((d) => d.id),
		titles,
		tf,
		len,
		avgLen: totals.map((t) => t / Math.max(size, 1)),
		postings,
		weight: docs.map((d) => LANE_KINDS[d.kind] ?? 1),
		df,
		size,
	};
}

export type DocsSearchResult = {
	id: string;
	score: number;
	/** 2: title equals the query; 1: title starts with it; 0: anything else. */
	tier: 0 | 1 | 2;
};

/** Compares stemmed title tokens to the stemmed query tokens, in order. */
function titleTier(title: string[], query: string[]): 0 | 1 | 2 {
	if (!query.length || title.length < query.length) return 0;
	if (!query.every((t, i) => title[i] === t)) return 0;
	return title.length === query.length ? 2 : 1;
}

/**
 * Top `k` docs for a query, best first; docs with no query term are omitted.
 * Order: exact title, then title prefix, then everything else; each tier by
 * BM25 score, then doc order.
 */
export function search(
	index: DocsSearchIndex,
	query: string,
	k: number,
): DocsSearchResult[] {
	const queryTokens = tokenize(query);
	const scores = new Map<number, number>();
	for (const term of new Set(queryTokens)) {
		const docs = index.postings.get(term);
		if (!docs) continue;
		const have = index.df.get(term) ?? 0;
		const idf = Math.log(1 + (index.size - have + 0.5) / (have + 0.5));
		for (const d of docs) {
			let weighted = 0;
			FIELDS.forEach((field, f) => {
				const count = index.tf[d][f].get(term);
				if (!count) return;
				const norm = 1 - B + (B * index.len[d][f]) / (index.avgLen[f] || 1);
				weighted += (FIELD_WEIGHTS[field] * count) / norm;
			});
			scores.set(
				d,
				(scores.get(d) ?? 0) + (idf * weighted * (K1 + 1)) / (weighted + K1),
			);
		}
	}
	return [...scores]
		.map(([d, raw]) => ({
			d,
			score: raw * (index.weight[d] ?? 1),
			tier: titleTier(index.titles[d], queryTokens),
		}))
		.sort((a, b) => b.tier - a.tier || b.score - a.score || a.d - b.d)
		.slice(0, k)
		.map(({ d, score, tier }) => ({ id: index.ids[d], score, tier }));
}

/**
 * A sure hit: an exact title match, or the top score clearly beats the
 * runner-up (or stands alone).
 */
export function confident(
	results: { score: number; tier?: number }[],
): boolean {
	if (!results.length || results[0].score <= 0) return false;
	if (results[0].tier === 2) return true;
	return (
		results.length === 1 ||
		results[0].score / results[1].score >= CONFIDENT_RATIO
	);
}
