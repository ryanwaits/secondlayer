"use client";

import { countByDisplayStatus } from "@/components/account/webhooks/shared";
import type { Insight } from "@/lib/insights";
import { useInsights } from "@/lib/insights-store";
import { useWebhooksCache } from "@/lib/webhooks-store";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { StatusPill } from "./status-pill";
import { TabIcon } from "./tab-icons";
import { useCompact } from "./use-compact";

export type MobileTabId =
	| "pulse"
	| "insights"
	| "webhooks"
	| "subgraphs"
	| "account";

export type MobileTab = {
	id: MobileTabId;
	href: string;
	label: string;
	match: readonly string[];
};

export const MOBILE_TABS: readonly MobileTab[] = [
	{ id: "pulse", href: "/account", label: "Pulse", match: [] }, // exact /account only
	{
		id: "insights",
		href: "/account/insights",
		label: "Insights",
		match: ["/account/insights"],
	},
	{
		id: "webhooks",
		href: "/account/webhooks",
		label: "Webhooks",
		match: ["/account/webhooks"],
	},
	{
		id: "subgraphs",
		href: "/account/subgraphs",
		label: "Subgraphs",
		match: ["/account/subgraphs"],
	},
	{
		id: "account",
		href: "/account/credits",
		label: "Account",
		match: [
			"/account/credits",
			"/account/rows",
			"/account/keys",
			"/account/push",
		],
	},
];

const SEEN_KEY = "sl.insights.seenAt";

function underPrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The current tab: Pulse only on exactly /account; others when the path equals or sits under a match prefix. */
export function currentTab(pathname: string): MobileTabId | null {
	if (pathname === "/account") return "pulse";
	const tab = MOBILE_TABS.find((t) =>
		t.match.some((prefix) => underPrefix(pathname, prefix)),
	);
	return tab?.id ?? null;
}

/** Header for a path: large title for tab roots; a back link for detail pages. */
export function mobileHeader(
	pathname: string,
):
	| { kind: "title"; title: string }
	| { kind: "back"; label: string; href: string } {
	for (const id of ["webhooks", "subgraphs"] as const) {
		const tab = MOBILE_TABS.find((t) => t.id === id);
		if (tab && pathname.startsWith(`${tab.href}/`)) {
			return { kind: "back", label: tab.label, href: tab.href };
		}
	}
	const id = currentTab(pathname);
	const tab = MOBILE_TABS.find((t) => t.id === id);
	return { kind: "title", title: tab?.label ?? "Account" };
}

/** Insights created after `seenAt` (ms) and not resolved. */
export function newInsightCount(
	insights: readonly Insight[],
	seenAt: number,
): number {
	return insights.filter(
		(i) => Date.parse(i.createdAt) > seenAt && !i.resolvedAt,
	).length;
}

/** The status pill (running replay, chain problem). Phone only: nothing mounts, polls or subscribes above 640px. */
export function StatusPillSlot(): ReactNode {
	const compact = useCompact();
	return compact ? <StatusPill /> : null;
}

export function MobileTabBar({
	pathname,
	failingWebhooks,
	newInsights,
}: {
	pathname: string;
	failingWebhooks?: number;
	newInsights?: number;
}) {
	const current = currentTab(pathname);
	return (
		<nav className="m-tabbar" aria-label="Account">
			{MOBILE_TABS.map((tab) => {
				const badge =
					tab.id === "webhooks"
						? { n: failingWebhooks ?? 0, kind: "is-bad", word: "failing" }
						: tab.id === "insights"
							? { n: newInsights ?? 0, kind: "is-new", word: "new" }
							: null;
				return (
					<Link
						key={tab.id}
						href={tab.href}
						className="m-tab"
						aria-current={current === tab.id ? "page" : undefined}
					>
						<TabIcon id={tab.id} />
						<span>{tab.label}</span>
						{badge && badge.n > 0 ? (
							<span
								className={`m-badge ${badge.kind}`}
								aria-label={`${badge.n} ${badge.word}`}
							>
								{badge.n}
							</span>
						) : null}
					</Link>
				);
			})}
		</nav>
	);
}

export function MobileHeader({ pathname }: { pathname: string }) {
	const header = mobileHeader(pathname);
	if (header.kind === "back") {
		return (
			<header className="m-head is-back">
				<Link className="m-back" href={header.href}>
					<svg
						width="11"
						height="18"
						viewBox="0 0 11 18"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M9 2L2 9l7 7" />
					</svg>
					<span>{header.label}</span>
				</Link>
				<StatusPillSlot />
			</header>
		);
	}
	return (
		<header className="m-head">
			<div className="m-head-row">
				<h1 className="m-title">{header.title}</h1>
				<StatusPillSlot />
			</div>
		</header>
	);
}

function readSeenAt(): number {
	try {
		return Number(localStorage.getItem(SEEN_KEY)) || 0;
	} catch {
		return 0;
	}
}

function writeSeenAt(at: number): void {
	try {
		localStorage.setItem(SEEN_KEY, String(at));
	} catch {
		// Per-device convenience only.
	}
}

/**
 * Phone frame for /account: large-title header on top, tab bar at the bottom.
 * Both are always rendered and hidden above 640px by CSS, so server and
 * client markup match.
 */
export function MobileShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const { list } = useWebhooksCache();
	const insights = useInsights();
	const [seenAt, setSeenAt] = useState(0);
	const onInsights = currentTab(pathname) === "insights";

	useEffect(() => {
		if (onInsights) {
			const now = Date.now();
			writeSeenAt(now);
			setSeenAt(now);
		} else {
			setSeenAt(readSeenAt());
		}
	}, [onInsights]);

	const failingWebhooks = list
		? countByDisplayStatus(list.data, "error")
		: undefined;
	return (
		<>
			<MobileHeader pathname={pathname} />
			{children}
			<MobileTabBar
				pathname={pathname}
				failingWebhooks={failingWebhooks}
				newInsights={newInsightCount(insights.data, seenAt)}
			/>
		</>
	);
}
