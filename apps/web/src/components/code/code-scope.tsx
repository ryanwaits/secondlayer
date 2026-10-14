"use client";

import { useEffect } from "react";

/**
 * Rendered by everything that needs the scope script (mentions, focus links,
 * pickers, steps), so a page that uses none of them never downloads it. It
 * draws nothing; the script is a separate chunk, imported once per page and
 * idempotent after that. Without JavaScript the prose reads as prose and the
 * code is complete.
 */
export function CodeScope() {
	useEffect(() => {
		import("./scope-runtime").then((m) => m.mountScope());
	}, []);
	return null;
}
