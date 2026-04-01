"use client";

import dynamic from "next/dynamic";

export const LazyCommandPalette = dynamic(
	() => import("./command-palette").then((m) => m.CommandPalette),
	{ ssr: false },
);
