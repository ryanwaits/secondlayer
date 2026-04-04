"use client";

import { ConsoleSidebar } from "./sidebar";

export function ConsoleShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="dash">
			<ConsoleSidebar />
			<main className="main-col">{children}</main>
		</div>
	);
}
