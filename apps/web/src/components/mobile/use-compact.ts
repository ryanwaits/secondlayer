"use client";

import { useMediaQuery } from "@/components/figures/use-media-query";
import {
	needsCompactWrite,
	readCompact,
	writeCompact,
} from "@/lib/compact-view";
import {
	type ReactNode,
	createContext,
	createElement,
	useContext,
	useEffect,
} from "react";

export const COMPACT_QUERY = "(max-width: 640px)";

const CompactSeedContext = createContext<boolean | null>(null);

export function CompactSeed({
	saved,
	children,
}: {
	saved: boolean | null;
	children: ReactNode;
}) {
	useEffect(() => {
		const mq = window.matchMedia(COMPACT_QUERY);
		const sync = () => {
			if (needsCompactWrite(readCompact(), mq.matches)) {
				writeCompact(mq.matches);
			}
		};
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);
	return createElement(CompactSeedContext.Provider, { value: saved }, children);
}

export function useCompact(): boolean {
	const saved = useContext(CompactSeedContext);
	return useMediaQuery(COMPACT_QUERY, saved === true);
}
