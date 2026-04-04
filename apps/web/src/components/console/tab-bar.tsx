"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useState } from "react";

interface Tab {
	id: string;
	label: string;
	href: string;
}

interface TabsContext {
	tabs: Tab[];
	addTab: (tab: Tab) => void;
	removeTab: (id: string) => void;
}

const TabsCtx = createContext<TabsContext>({
	tabs: [],
	addTab: () => {},
	removeTab: () => {},
});

export function useSessionTabs() {
	return useContext(TabsCtx);
}

export function SessionTabsProvider({ children }: { children: React.ReactNode }) {
	const [tabs, setTabs] = useState<Tab[]>([]);

	const addTab = useCallback((tab: Tab) => {
		setTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
	}, []);

	const removeTab = useCallback((id: string) => {
		setTabs((prev) => prev.filter((t) => t.id !== id));
	}, []);

	return (
		<TabsCtx.Provider value={{ tabs, addTab, removeTab }}>
			{children}
		</TabsCtx.Provider>
	);
}

export function SessionTabBar() {
	const pathname = usePathname();
	const { tabs, removeTab } = useSessionTabs();
	const isHome = pathname === "/sessions" || pathname === "/platform/sessions";

	return (
		<div className="session-tab-bar">
			{/* Home tab */}
			<Link
				href="/sessions"
				className={`session-tab${isHome ? " active" : ""}`}
			>
				<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
					<path d="M2 6.5L8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5z" />
					<path d="M6 14V9h4v5" />
				</svg>
				<span className="tab-label">New Session</span>
			</Link>

			{/* Open tabs */}
			{tabs.map((tab) => {
				const active =
					pathname === tab.href ||
					pathname === `/platform${tab.href}`;
				return (
					<Link
						key={tab.id}
						href={tab.href}
						className={`session-tab${active ? " active" : ""}`}
					>
						<span className="tab-label">{tab.label}</span>
						<button
							type="button"
							className="session-tab-close"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								removeTab(tab.id);
							}}
						>
							<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
								<path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
							</svg>
						</button>
					</Link>
				);
			})}

			{/* New tab */}
			<Link href="/sessions" className="session-tab-new" title="New session">
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
					<path d="M6 2v8M2 6h8" />
				</svg>
			</Link>
		</div>
	);
}
