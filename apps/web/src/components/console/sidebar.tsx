"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ProjectSwitcher } from "./project-switcher";
import { UserModal } from "./user-modal";

interface NavItem {
	href: string;
	label: string;
	icon: string;
	badgeKey?: string;
}

const NAV_ITEMS: NavItem[] = [
	{ href: "/", label: "Home", icon: "home" },
	{ href: "/subgraphs", label: "Subgraphs", icon: "subgraph", badgeKey: "subgraphs" },
	{ href: "/streams", label: "Streams", icon: "stream", badgeKey: "streams" },
	{ href: "/sessions", label: "Sessions", icon: "sessions" },
	{ href: "/agents", label: "Agents", icon: "agents" },
	{ href: "/marketplace", label: "Marketplace", icon: "marketplace" },
];

const SETTINGS_CHILDREN = [
	{ href: "/settings", label: "Project" },
	{ href: "/api-keys", label: "API Keys" },
	{ href: "/team", label: "Team" },
	{ href: "/usage", label: "Usage" },
];

const ICONS: Record<string, React.ReactNode> = {
	home: (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<path d="M2 6.5L8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5z" />
			<path d="M6 14V9h4v5" />
		</svg>
	),
	subgraph: (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
			<path d="M9 2L5 14M3 5l-2 3 2 3M13 5l2 3-2 3" />
		</svg>
	),
	stream: (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
			<circle cx="8" cy="8" r="2" />
			<path d="M2 8h4M10 8h4" />
		</svg>
	),
	sessions: (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<rect x="2" y="2" width="5" height="5" rx="1" />
			<rect x="9" y="2" width="5" height="5" rx="1" />
			<rect x="2" y="9" width="5" height="5" rx="1" />
			<rect x="9" y="9" width="5" height="5" rx="1" />
		</svg>
	),
	agents: (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="8" cy="5" r="3" />
			<path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
		</svg>
	),
	marketplace: (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
			<path d="M3 3h10v10H3z" />
			<path d="M3 8h10" />
			<path d="M8 3v10" />
		</svg>
	),
	settings: (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
			<circle cx="8" cy="8" r="2.5" />
			<path d="M13.5 8a5.5 5.5 0 0 1-.3 1.8l1.3.8a.5.5 0 0 1 .1.6l-1 1.7a.5.5 0 0 1-.6.2l-1.3-.7a5.5 5.5 0 0 1-1.5.9l-.2 1.5a.5.5 0 0 1-.5.4H7.5a.5.5 0 0 1-.5-.4l-.2-1.5A5.5 5.5 0 0 1 5.3 12L4 12.8a.5.5 0 0 1-.6-.2l-1-1.7a.5.5 0 0 1 .1-.6l1.3-.8A5.5 5.5 0 0 1 3.5 8c0-.6.1-1.2.3-1.8L2.5 5.4a.5.5 0 0 1-.1-.6l1-1.7a.5.5 0 0 1 .6-.2l1.3.7A5.5 5.5 0 0 1 6.8 2.7L7 1.2a.5.5 0 0 1 .5-.4h2a.5.5 0 0 1 .5.4l.2 1.5a5.5 5.5 0 0 1 1.5.9L13 2.9a.5.5 0 0 1 .6.2l1 1.7a.5.5 0 0 1-.1.6l-1.3.8c.2.6.3 1.2.3 1.8z" />
		</svg>
	),
};

function useSidebarCounts() {
	const [counts, setCounts] = useState<Record<string, number>>({});
	useEffect(() => {
		Promise.allSettled([
			fetch("/api/subgraphs", { credentials: "same-origin" }).then(r => r.json()),
			fetch("/api/streams?limit=1&offset=0", { credentials: "same-origin" }).then(r => r.json()),
		]).then(([sg, st]) => {
			const c: Record<string, number> = {};
			if (sg.status === "fulfilled" && sg.value?.data) c.subgraphs = sg.value.data.length;
			if (st.status === "fulfilled" && st.value?.total != null) c.streams = st.value.total;
			setCounts(c);
		});
	}, []);
	return counts;
}

function isActive(pathname: string, href: string) {
	if (href === "/") return pathname === "/platform" || pathname === "/";
	// Strip /platform prefix for comparison since middleware rewrites
	const clean = pathname.replace(/^\/platform/, "");
	return clean === href || clean.startsWith(href + "/");
}

function isSettingsActive(pathname: string) {
	const clean = pathname.replace(/^\/platform/, "");
	return (
		clean.startsWith("/settings") ||
		clean.startsWith("/api-keys") ||
		clean.startsWith("/team") ||
		clean.startsWith("/usage")
	);
}

export function ConsoleSidebar() {
	const pathname = usePathname();
	const { account } = useAuth();
	const counts = useSidebarCounts();
	const [settingsOpen, setSettingsOpen] = useState(true);
	const [userModalOpen, setUserModalOpen] = useState(false);
	const initial = account?.email ? account.email[0].toUpperCase() : "U";

	return (
		<>
			<nav className="sidebar">
				{/* Logo */}
				<Link href="/" className="sidebar-logo">
					<svg viewBox="4 7 40 28" width="24" height="16" fill="none">
						<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
						<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
					</svg>
					<span className="sidebar-logo-text">secondlayer</span>
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
							{item.badgeKey && counts[item.badgeKey] != null && (
								<span className="sb-item-badge">{counts[item.badgeKey]}</span>
							)}
						</Link>
					))}

					{/* Settings accordion */}
					<button
						type="button"
						className={`sb-item sb-accordion-toggle${settingsOpen ? " open" : ""}`}
						onClick={() => setSettingsOpen(!settingsOpen)}
					>
						<span className="sb-item-icon">{ICONS.settings}</span>
						<span className="sb-item-label">Settings</span>
						<span className="sb-accordion-chevron">
							<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
								<path d="M4 6l4 4 4-4" />
							</svg>
						</span>
					</button>
					<div className={`sb-accordion${settingsOpen ? " open" : ""}`}>
						{SETTINGS_CHILDREN.map((child) => (
							<Link
								key={child.label}
								href={child.href}
								className={`sb-item sb-child${isActive(pathname, child.href) && !isSettingsActive(pathname) ? "" : isActive(pathname, child.href) ? " active" : ""}`}
							>
								<span className="sb-item-label">{child.label}</span>
							</Link>
						))}
					</div>
				</div>

				{/* Bottom */}
				<div className="sidebar-bottom">
					<div
						className="sb-bottom-item"
						style={{ cursor: "pointer" }}
						onClick={() => {
							window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
						}}
					>
						<span className="sb-bottom-icon">
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
								<circle cx="7" cy="7" r="4.5" />
								<path d="M10.5 10.5L14 14" />
							</svg>
						</span>
						<span>Search</span>
						<span className="sb-bottom-right">
							<kbd style={{ display: "inline-flex", alignItems: "center", padding: "2px 5px", borderRadius: 4, background: "var(--code-bg)", fontFamily: "var(--font-mono-stack)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>
								⌘K
							</kbd>
						</span>
					</div>
					<div
						className="sb-bottom-item"
						style={{ cursor: "pointer" }}
						onClick={() => window.open("https://docs.secondlayer.xyz", "_blank")}
					>
						<span className="sb-bottom-icon">
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
								<path d="M2 4h12M2 8h8M2 12h10" />
							</svg>
						</span>
						<span>Docs</span>
					</div>
				</div>

				{/* Project switcher + avatar */}
				<ProjectSwitcher
					avatar={
						<div className="org-avatar" onClick={() => setUserModalOpen(true)}>
							{initial}
						</div>
					}
				/>
			</nav>

			{/* User modal */}
			<UserModal open={userModalOpen} onClose={() => setUserModalOpen(false)} />
		</>
	);
}
