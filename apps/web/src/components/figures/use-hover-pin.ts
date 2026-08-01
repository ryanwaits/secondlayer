"use client";

import { useState } from "react";

/**
 * Shared hover/focus/tap-pin state for annotation figures (A4 payload
 * fields, A6 code lines, D5 cross-highlight): hover and focus light an
 * id; a tap pins it (so touch never depends on hover).
 */
export function useHoverPin() {
	const [active, setActive] = useState<string | null>(null);
	const bind = (id: string) => ({
		onMouseEnter: () => setActive(id),
		onMouseLeave: () => setActive(null),
		onFocus: () => setActive(id),
		onBlur: () => setActive(null),
		onClick: () => setActive(id),
	});
	return { active, bind };
}
