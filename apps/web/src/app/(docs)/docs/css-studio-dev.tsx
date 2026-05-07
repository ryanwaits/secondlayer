"use client";

import { useEffect } from "react";

export function CssStudioDev() {
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return;

		let cleanup: (() => void) | undefined;
		let cancelled = false;

		void import("cssstudio").then(({ startStudio }) => {
			if (cancelled) return;
			cleanup = startStudio();
		});

		return () => {
			cancelled = true;
			cleanup?.();
		};
	}, []);

	return null;
}
