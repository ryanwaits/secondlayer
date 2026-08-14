"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Identity block for the sidebar footer. Server-resolved once per request
 * from `/v1/instance` + `/health` — the sidebar itself never fetches. Fields
 * are null when the instance was unreachable; the footer degrades to dashes
 * rather than hiding, so a down runtime is still legible in the chrome.
 */
export interface InstanceMeta {
	network: string | null;
	mode: string | null;
	imageSha: string | null;
	instanceId: string | null;
}

interface NavItem {
	href: string;
	label: string;
	icon: string;
}

const NAV_ITEMS: NavItem[] = [
	{ href: "/", label: "Overview", icon: "overview" },
	{ href: "/subgraphs", label: "Subgraphs", icon: "subgraph" },
	{ href: "/subscriptions", label: "Subscriptions", icon: "subscription" },
];

const ICONS: Record<string, React.ReactNode> = {
	overview: (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
			stroke="currentColor"
			strokeWidth="1.3"
		>
			<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
			<rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
			<rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
			<rect x="9" y="9" width="5.5" height="5.5" rx="1" />
		</svg>
	),
	subgraph: (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
			stroke="currentColor"
			strokeWidth="1.3"
		>
			<path d="M2 4.5h12M2 8h12M2 11.5h12" />
		</svg>
	),
	subscription: (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
			stroke="currentColor"
			strokeWidth="1.3"
		>
			<path d="M2 8c2.5 0 2.5-5 5-5s2.5 10 5 10 2.5-5 2-5" />
		</svg>
	),
};

function isActive(pathname: string, href: string) {
	if (href === "/") return pathname === "/";
	// A subgraph's subscription screens live under /subgraphs/…, so they light
	// the Subgraphs entry; /subscriptions only matches the global index.
	return pathname === href || pathname.startsWith(`${href}/`);
}

function shortSha(sha: string): string {
	return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function shortId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

export function ConsoleSidebar({ meta }: { meta: InstanceMeta }) {
	const pathname = usePathname();

	return (
		<nav className="sidebar">
			{/* Wordmark */}
			<Link href="/" className="sidebar-logo">
				<svg
					viewBox="4 7 40 28"
					width="24"
					height="16"
					fill="none"
					aria-hidden="true"
				>
					<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
					<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
				</svg>
				<span className="sidebar-logo-text">
					secondlayer <span className="sidebar-logo-echo">console</span>
				</span>
			</Link>

			{/* Main nav */}
			<div className="sidebar-nav">
				{NAV_ITEMS.map((item) => (
					<Link
						key={item.href}
						href={item.href}
						className={`sb-item${isActive(pathname, item.href) ? " active" : ""}`}
					>
						<span className="sb-item-icon">{ICONS[item.icon]}</span>
						<span className="sb-item-label">{item.label}</span>
					</Link>
				))}
			</div>

			{/* Instance identity — replaces the hosted era's account menu. */}
			<div className="sb-foot">
				{meta.network ?? "—"} · {meta.mode ?? "—"}
				<br />
				image {meta.imageSha ? shortSha(meta.imageSha) : "—"}
				<br />
				instance {meta.instanceId ? shortId(meta.instanceId) : "—"}
			</div>
		</nav>
	);
}
