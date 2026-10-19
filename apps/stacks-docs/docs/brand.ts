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
		paper: "#fbfaf7",
		ink: "#14110d",
		sub: "#63605c",
		faint: "#9d9b97",
		line: "#e8e6e3",
		soft: "#f5f3f0",
		pri: "#1f45e0",
		"on-pri": "#fbfaf7",
		hi: "#ffcc00",
		"on-hi": "#14110d",
		ok: "#128a43",
		alarm: "#e3301e",
	},
	dark: {
		paper: "#1e1b17",
		ink: "#e8e6e3",
		sub: "#b3b1ad",
		faint: "#7c7a76",
		line: "#393632",
		soft: "#272520",
		pri: "#3a5bff",
		"on-pri": "#fbfaf7",
		hi: "#efc54a",
		"on-hi": "#14110d",
		ok: "#5cc28f",
		alarm: "#ff5a47",
	},
};

/** `#rrggbb` at an alpha, as rgba(); for Vocs slots that want an ink ramp. */
export function alpha(hex: string, a: number): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
