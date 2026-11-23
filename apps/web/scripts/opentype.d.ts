/** The slice of opentype.js (ships no types) that generate-readme-hero uses. */
declare module "opentype.js" {
	interface Path {
		toPathData(decimalPlaces?: number): string;
	}
	interface Glyph {
		index: number;
		advanceWidth?: number;
		getPath(x: number, y: number, fontSize: number): Path;
	}
	interface Font {
		unitsPerEm: number;
		stringToGlyphs(text: string): Glyph[];
		getKerningValue(left: Glyph, right: Glyph): number;
	}
	export function parse(buffer: ArrayBuffer): Font;
}
