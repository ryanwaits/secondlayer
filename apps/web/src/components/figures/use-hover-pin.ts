"use client";

import { useState } from "react";

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
