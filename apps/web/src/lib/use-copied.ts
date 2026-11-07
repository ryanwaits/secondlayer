"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "./docs-clipboard";

/** A flag that turns on, then off again after `ms`. Firing again restarts the wait. */
export function createFlash(ms: number, set: (on: boolean) => void) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		fire() {
			clearTimeout(timer);
			set(true);
			timer = setTimeout(() => set(false), ms);
		},
		cancel() {
			clearTimeout(timer);
		},
	};
}

/**
 * Copy to the clipboard and flash `copied` for `resetMs`. `copied` turns on
 * only once the write resolved; `copy` returns whether it did, so a caller can
 * fall back when the clipboard refuses. The timer is cleared on unmount.
 */
export function useCopied(resetMs = 1400) {
	const [copied, setCopied] = useState(false);
	const flash = useRef<ReturnType<typeof createFlash> | null>(null);
	if (flash.current === null) flash.current = createFlash(resetMs, setCopied);
	useEffect(() => () => flash.current?.cancel(), []);

	const copy = useCallback(async (text: string): Promise<boolean> => {
		const ok = await copyText(text);
		if (ok) flash.current?.fire();
		return ok;
	}, []);

	return { copied, copy };
}
