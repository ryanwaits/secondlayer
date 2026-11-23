"use client";

import { type ReactNode, createContext, useContext, useState } from "react";

const DocsDrawerContext = createContext<{
	open: boolean;
	setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function useDocsDrawer() {
	return useContext(DocsDrawerContext);
}

export function DocsDrawerProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<DocsDrawerContext.Provider value={{ open, setOpen }}>
			{children}
		</DocsDrawerContext.Provider>
	);
}
