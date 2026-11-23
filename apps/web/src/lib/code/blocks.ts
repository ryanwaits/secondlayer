/**
 * A screen describes the blocks it wants (`CodeBlockInput`); the server renders
 * them with the docs code renderer because Shiki doesn't run in the browser.
 */

export const MAX_CODE_BLOCKS = 10;

export type CodeBlockInput = {
	code: string;
	title: string;
	lines: number;
	lang?: "ts" | "bash";
};

export type RenderedBlock = {
	className: string;
	copyable: boolean;
	html: string;
};

export const blockTitle = (name: string): string =>
	`${name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48)}.ts`;
