"use client";

import { SessionTabBar, SessionTabsProvider } from "@/components/console/tab-bar";

export default function SessionsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<SessionTabsProvider>
			<SessionTabBar />
			<div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>{children}</div>
		</SessionTabsProvider>
	);
}
