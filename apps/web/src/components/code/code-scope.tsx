"use client";

import { useEffect } from "react";

export function CodeScope() {
	useEffect(() => {
		import("./scope-runtime").then((m) => m.mountScope());
	}, []);
	return null;
}
