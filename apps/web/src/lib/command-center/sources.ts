"use client";

import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";
import { type CommandItem, badgeFor, formatRows } from "./items";

/**
 * Resource feeds for the command center. One prefetch per palette session,
 * stale-while-revalidate via localStorage so a cold open paints instantly
 * from the last payload while fresh data loads behind it. Every source is
 * local after this — there are no remote searches and no loading states
 * (docs/specs/command-center.spec.md §4).
 */

const CACHE_KEY = "cc-sources";

type OwnSubgraph = { name: string; status?: string; visibility?: string };
type OwnSubscription = {
	id: string;
	name: string;
	status?: string;
	kind?: string;
	subgraphName?: string | null;
	tableName?: string | null;
};
type PublicSubgraph = { name: string; status?: string; total_rows?: number };

type Payload = {
	own: OwnSubgraph[];
	subs: OwnSubscription[];
	pub: PublicSubgraph[];
};

const EMPTY: Payload = { own: [], subs: [], pub: [] };

function readCache(): Payload {
	try {
		return {
			...EMPTY,
			...JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}"),
		} as Payload;
	} catch {
		return EMPTY;
	}
}

function writeCache(p: Payload): void {
	try {
		window.localStorage.setItem(CACHE_KEY, JSON.stringify(p));
	} catch {
		// best-effort cache only
	}
}

async function getJson<T>(url: string): Promise<T | null> {
	try {
		const res = await fetch(url, { credentials: "same-origin" });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

function toItems(p: Payload, authed: boolean): CommandItem[] {
	const ownNames = new Set(p.own.map((s) => s.name));
	const items: CommandItem[] = [];

	for (const s of p.own) {
		items.push({
			id: `own:${s.name}`,
			group: "your subgraphs",
			label: s.name,
			sub: s.visibility === "private" ? "private" : "public",
			badge: badgeFor(s.status),
			href: `/subgraphs/${s.name}`,
		});
	}

	for (const s of p.subs) {
		items.push({
			id: `sub:${s.id}`,
			group: "subscriptions",
			label: s.name,
			sub: s.subgraphName
				? `${s.subgraphName}.${s.tableName ?? "*"}`
				: "chain events",
			badge: badgeFor(s.status),
			href: s.subgraphName
				? `/subgraphs/${s.subgraphName}/subscriptions/${s.id}`
				: "/subgraphs",
			keywords: ["webhook", "subscription"],
		});
	}

	for (const s of p.pub) {
		// Own deploys already appear under "your subgraphs" — don't double-list.
		if (ownNames.has(s.name)) continue;
		items.push({
			id: `pub:${s.name}`,
			group: "public subgraphs",
			label: s.name,
			sub: formatRows(s.total_rows),
			badge: badgeFor(s.status),
			href: authed ? `/subgraphs/${s.name}` : `/subgraphs/explore/${s.name}`,
		});
	}

	return items;
}

export function useCommandSources(open: boolean): CommandItem[] {
	const { account } = useAuth();
	const [items, setItems] = useState<CommandItem[]>([]);
	const [fetched, setFetched] = useState(false);

	useEffect(() => {
		if (!open) return;
		// Paint instantly from the last payload, then revalidate once.
		setItems(toItems(readCache(), !!account));
		if (fetched) return;
		setFetched(true);

		(async () => {
			const [own, subs, pub] = await Promise.all([
				account
					? getJson<{ data?: OwnSubgraph[] }>("/api/subgraphs")
					: Promise.resolve(null),
				account
					? getJson<{ data?: OwnSubscription[] }>("/api/subscriptions")
					: Promise.resolve(null),
				getJson<{ subgraphs?: PublicSubgraph[] }>("/api/discovery"),
			]);
			const fresh: Payload = {
				own: own?.data ?? readCache().own,
				subs: subs?.data ?? readCache().subs,
				pub: pub?.subgraphs ?? readCache().pub,
			};
			writeCache(fresh);
			setItems(toItems(fresh, !!account));
		})();
	}, [open, account, fetched]);

	return items;
}
