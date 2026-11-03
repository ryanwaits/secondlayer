/**
 * Code frames for the account screens. A screen describes the blocks it wants
 * (`CodeBlockInput`); the server renders them with the docs code renderer
 * because Shiki doesn't run in the browser. The page render does this for the
 * first paint, `/api/code` for later version changes.
 */

/** The most blocks one render (or one `/api/code` request) takes. */
export const MAX_CODE_BLOCKS = 10;

export type CodeBlockInput = { code: string; title: string; lines: number };

export type RenderedBlock = {
	className: string;
	copyable: boolean;
	html: string;
};

/** A file name the code frame's bar can show for this resource. */
export const blockTitle = (name: string): string =>
	`${name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48)}.ts`;
