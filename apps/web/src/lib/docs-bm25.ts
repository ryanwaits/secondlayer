export type DocsSearchDoc = {
	id: string;
	href: string;
	label: string;
	sub: string;
	kind: "page" | "section" | "endpoint" | "method";
	title: string;
	page: string;
	phrasings: string[];
	body: string;
};

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
const CONFIDENT_RATIO = 1.4;

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
	tf: Map<string, number>[][];
	len: number[][];
	avgLen: number[];
	titles: string[][];
	postings: Map<string, number[]>;
	weight: number[];
	df: Map<string, number>;
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
	tier: 0 | 1 | 2;
};

function titleTier(title: string[], query: string[]): 0 | 1 | 2 {
	if (!query.length || title.length < query.length) return 0;
	if (!query.every((t, i) => title[i] === t)) return 0;
	return title.length === query.length ? 2 : 1;
}

export function search(
	index: DocsSearchIndex,
	query: string,
	k: number,
): DocsSearchResult[] {
	return searchTokens(index, tokenize(query), k);
}

export function searchTokens(
	index: DocsSearchIndex,
	queryTokens: string[],
	k: number,
): DocsSearchResult[] {
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
