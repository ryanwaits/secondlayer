import type { ThemeRegistrationRaw } from "shiki";

/**
 * Syntax is a four-step ladder, never a hue: calls and commands in ink at 500,
 * identifiers/strings/numbers in ink, keywords/keys/flags in sub, punctuation/
 * quotes/comments in faint. Color is reserved for annotations and output rules.
 * The hexes are the `--ink`, `--sub` and `--faint` tokens in globals.css (a
 * theme cannot read CSS variables, so the values are mirrored here).
 */
type Ladder = {
	ink: string;
	sub: string;
	faint: string;
	background: string;
	selection: string;
};

const LIGHT: Ladder = {
	ink: "#111111",
	sub: "#5e5e5e",
	faint: "#9b9b96",
	background: "#ffffff",
	selection: "#e5e5e2",
};

const DARK: Ladder = {
	ink: "#ece9e2",
	sub: "#b0aca2",
	faint: "#7c786f",
	background: "#252420",
	selection: "#2a2c31",
};

function theme(
	name: string,
	type: "light" | "dark",
	l: Ladder,
): ThemeRegistrationRaw {
	return {
		name,
		type,
		colors: {
			"editor.background": l.background,
			"editor.foreground": l.ink,
			"editorLineNumber.foreground": l.faint,
			"editor.selectionBackground": l.selection,
		},
		settings: [
			{ settings: { foreground: l.ink } },
			// Faint: comments, punctuation, operators, quotes.
			{
				scope: [
					"comment",
					"punctuation",
					"meta.brace",
					"keyword.operator",
					"punctuation.definition.string",
					"punctuation.definition.template-expression",
					"punctuation.separator",
					"punctuation.terminator",
				],
				settings: { foreground: l.faint },
			},
			// Sub: keywords, storage, keys, flags, attributes.
			{
				scope: [
					"keyword",
					"storage",
					"storage.type",
					"keyword.control",
					"keyword.operator.new",
					"keyword.operator.expression",
					"constant.language",
					"variable.language.this",
					"meta.object-literal.key",
					"support.type.property-name",
					"entity.other.attribute-name",
					"constant.other.option",
					"variable.parameter.option",
					"markup.heading punctuation.definition.heading",
					"punctuation.definition.list.begin.markdown",
				],
				settings: { foreground: l.sub },
			},
			// Ink: strings, numbers and JSON literals sit on the ground color.
			{
				scope: [
					"string",
					"constant.numeric",
					"constant.language.json",
					"constant.language.boolean",
					"constant.character.escape",
				],
				settings: { foreground: l.ink },
			},
			// Ink at 500: calls, commands, environment variables.
			{
				scope: [
					"entity.name.function",
					"support.function",
					"entity.name.command",
					"entity.name.function.call.shell",
					"support.function.builtin",
					"variable.other.normal.shell",
					"variable.other.special",
					"punctuation.definition.variable",
					"markup.heading",
					"entity.name.section",
					"markup.bold",
				],
				settings: { foreground: l.ink, fontStyle: "bold" },
			},
			// A method-valued key is still a key.
			{
				scope: ["meta.object-literal.key entity.name.function"],
				settings: { foreground: l.sub, fontStyle: "" },
			},
			// Shell flags keep the sub step even after a command-like scope.
			{
				scope: ["punctuation.definition.parameter.shell"],
				settings: { foreground: l.sub },
			},
			{ scope: ["markup.italic"], settings: { fontStyle: "italic" } },
			// JSON keys read as keys, not strings.
			{
				scope: [
					"support.type.property-name.json",
					"meta.structure.dictionary.key.json string",
				],
				settings: { foreground: l.sub },
			},
			{
				scope: [
					"support.type.property-name.json punctuation.definition.string",
				],
				settings: { foreground: l.faint },
			},
		],
	};
}

export const secondlayer = theme("secondlayer", "light", LIGHT);
export const secondlayerDark = theme("secondlayer-dark", "dark", DARK);

export const LADDER_STEPS = ["ink", "sub", "faint"] as const;
export type LadderStep = (typeof LADDER_STEPS)[number];

/** The ladder step a token's light and dark colors spell, or null for a color off the ladder. */
export function ladderStep(
	light: string | undefined,
	dark: string | undefined,
): LadderStep | null {
	const same = (a: string | undefined, b: string) =>
		a?.toLowerCase() === b.toLowerCase();
	return (
		LADDER_STEPS.find((s) => same(light, LIGHT[s]) && same(dark, DARK[s])) ??
		null
	);
}

/** Each step's two hexes, for the stylesheet that mirrors them. */
export const LADDER_HEXES = Object.fromEntries(
	LADDER_STEPS.map((s) => [s, { light: LIGHT[s], dark: DARK[s] }]),
) as Record<LadderStep, { light: string; dark: string }>;
