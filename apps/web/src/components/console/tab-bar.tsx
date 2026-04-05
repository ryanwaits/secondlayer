"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState } from "react";

interface Tab {
	id: string;
	label: string;
	href: string;
}

interface TabsContext {
	tabs: Tab[];
	addTab: (tab: Tab) => void;
	updateTab: (id: string, updates: Partial<Pick<Tab, "label">>) => void;
	removeTab: (id: string) => void;
}

const TabsCtx = createContext<TabsContext>({
	tabs: [],
	addTab: () => {},
	updateTab: () => {},
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

	const updateTab = useCallback((id: string, updates: Partial<Pick<Tab, "label">>) => {
		setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
	}, []);

	const removeTab = useCallback((id: string) => {
		setTabs((prev) => prev.filter((t) => t.id !== id));
	}, []);

	return (
		<TabsCtx.Provider value={{ tabs, addTab, updateTab, removeTab }}>
			{children}
		</TabsCtx.Provider>
	);
}

export function SessionTabBar() {
	const pathname = usePathname();
	const router = useRouter();
	const { tabs, removeTab } = useSessionTabs();
	const isHome = pathname === "/sessions" || pathname === "/platform/sessions";

	const handleClose = useCallback(
		(id: string, index: number) => {
			const isActive =
				pathname === tabs[index].href ||
				pathname === `/platform${tabs[index].href}`;
			removeTab(id);
			if (!isActive) return;
			// Navigate to tab to the left, or home if last tab
			const next = tabs[index - 1] ?? tabs[index + 1];
			router.push(next ? next.href : "/sessions");
		},
		[pathname, tabs, removeTab, router],
	);

	return (
		<div className="session-tab-bar">
			{/* Open tabs — includes "Untitled" tabs for new sessions */}
			{tabs.map((tab, i) => {
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
								handleClose(tab.id, i);
							}}
						>
							<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
								<path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
							</svg>
						</button>
					</Link>
				);
			})}

			{/* New tab — no-op if already on welcome with no tabs */}
			{!(isHome && tabs.length === 0) && (
				<Link href="/sessions" className="session-tab-new" title="New session">
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
						<path d="M6 2v8M2 6h8" />
					</svg>
				</Link>
			)}
		</div>
	);
}
