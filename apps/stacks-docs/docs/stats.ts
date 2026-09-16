import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/* Build-time repo stats for the landing badge row. Runs inside
   vocs.config.tsx (Node), never in the browser. GitHub's unauthenticated
   API allows 60 req/h, so a miss falls back to the last cached value in
   docs/.cache; a first-ever miss yields null and the badge is not shown. */

const REPO = "ryanwaits/secondlayer";
const CACHE = resolve(import.meta.dirname, ".cache/stats.json");

type Stats = { stars: number | null; fetchedAt: string };

function readCache(): Stats | null {
	try {
		return JSON.parse(readFileSync(CACHE, "utf8")) as Stats;
	} catch {
		return null;
	}
}

function writeCache(stats: Stats) {
	mkdirSync(dirname(CACHE), { recursive: true });
	writeFileSync(CACHE, `${JSON.stringify(stats, null, "\t")}\n`);
}

export async function getStars(): Promise<number | null> {
	try {
		const res = await fetch(`https://api.github.com/repos/${REPO}`, {
			headers: { accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) throw new Error(`github ${res.status}`);
		const { stargazers_count } = (await res.json()) as {
			stargazers_count: number;
		};
		writeCache({
			stars: stargazers_count,
			fetchedAt: new Date().toISOString(),
		});
		return stargazers_count;
	} catch {
		return readCache()?.stars ?? null;
	}
}
