const KEY = "cc-recents";
const MAX = 50;

type Recent = { id: string; ts: number; count: number };

function load(): Recent[] {
	if (typeof window === "undefined") return [];
	try {
		return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Recent[];
	} catch {
		return [];
	}
}

export function recordSelection(id: string): void {
	try {
		const all = load();
		const hit = all.find((r) => r.id === id);
		if (hit) {
			hit.ts = Date.now();
			hit.count += 1;
		} else {
			all.push({ id, ts: Date.now(), count: 1 });
		}
		all.sort((a, b) => b.ts - a.ts);
		window.localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
	} catch {}
}

export function frecencyBoosts(): Map<string, number> {
	const map = new Map<string, number>();
	const week = 7 * 24 * 60 * 60 * 1000;
	for (const r of load()) {
		const base = Math.min(40, Math.round(Math.log2(1 + r.count) * 14));
		map.set(r.id, Date.now() - r.ts > week ? Math.round(base / 2) : base);
	}
	return map;
}
