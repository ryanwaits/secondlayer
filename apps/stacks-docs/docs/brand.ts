/* Brand roles for the Vocs config. These mirror the `colors` frontmatter in
   the repo-root DESIGN.md; test/brand.test.ts fails on drift. They live here
   because vocs.config.tsx cannot read CSS variables. */

export type Roles = {
	paper: string;
	ink: string;
	sub: string;
	faint: string;
	line: string;
	soft: string;
	pri: string;
	"on-pri": string;
	hi: string;
	"on-hi": string;
	ok: string;
	alarm: string;
};

export const brand: { light: Roles; dark: Roles } = {
	light: {
		paper: "#ffffff",
		ink: "#111111",
		sub: "#5e5e5e",
		faint: "#9b9b96",
		line: "#e5e5e2",
		soft: "#f5f5f2",
		pri: "#1f45e0",
		"on-pri": "#ffffff",
		hi: "#ffcc00",
		"on-hi": "#111111",
		ok: "#128a43",
		alarm: "#e3301e",
	},
	dark: {
		paper: "#1c1b19",
		ink: "#ece9e2",
		sub: "#b0aca2",
		faint: "#7c786f",
		line: "#383631",
		soft: "#252420",
		pri: "#3a5bff",
		"on-pri": "#ffffff",
		hi: "#efc54a",
		"on-hi": "#141414",
		ok: "#5cc28f",
		alarm: "#ff5a47",
	},
};

/** `#rrggbb` at an alpha, as rgba(); for Vocs slots that want an ink ramp. */
export function alpha(hex: string, a: number): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
