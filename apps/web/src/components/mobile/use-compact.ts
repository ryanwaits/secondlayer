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

/** The phone layout: viewport ≤640px. Never sniffs the device. */
export const COMPACT_QUERY = "(max-width: 640px)";

/** The layout the last visit ended in, from the cookie. Null = unknown. */
const CompactSeedContext = createContext<boolean | null>(null);

/** Seeds the server render with the saved layout and keeps the cookie in step
 *  with the real viewport. Mount once, above every `useCompact` caller. */
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

/** True at the phone layout. The server render follows the saved layout, or
 *  the desktop tree when none is saved. */
export function useCompact(): boolean {
	const saved = useContext(CompactSeedContext);
	return useMediaQuery(COMPACT_QUERY, saved === true);
}
