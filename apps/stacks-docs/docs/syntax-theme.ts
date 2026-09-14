import type { ThemeRegistrationRaw } from "shiki";

/**
 * Code block syntax theme for stacks.secondlayer.tools.
 *
 * Derived from the platform docs theme (apps/web/src/lib/syntax-theme.ts):
 * same scope list, same "one weight step, ink alpha ramp" discipline. The
 * one change is where the library's gold lands: literals only (strings,
 * numbers, JSON values), the tokens a reader copies out of a snippet.
 * Keywords and shell commands stay ink at weight 500. Nothing is bold.
 *
 * Grounds are the site's egg-white and warm-dark surfaces, so the ink ramp
 * is warm-tinted rather than the platform's neutral grays.
 */

const light = {
	surface: "#fffdf8",
	ink: "#1c1a16",
	call: "#2a2722",
	fg: "#3a3630",
	type: "#4a453e",
	key: "#5e5850",
	op: "#9a938a",
	comment: "#a39b8e",
	gold: "#8a6800",
} as const;

const dark = {
	surface: "#1a1815",
	ink: "#f2ede5",
	call: "#e6e0d4",
	fg: "#cfc8bc",
	type: "#d9d2c6",
	key: "#a39b8e",
	op: "#7a7369",
	comment: "#6e675e",
	gold: "#f0c430",
} as const;

type Palette = typeof light | typeof dark;

function build(
	name: string,
	type: "light" | "dark",
	c: Palette,
): ThemeRegistrationRaw {
	return {
		name,
		type,
		colors: {
			"editor.background": c.surface,
			"editor.foreground": c.fg,
			"editorLineNumber.foreground": c.op,
			"editor.selectionBackground": type === "light" ? "#ece7db" : "#2a2724",
		},
		settings: [
			{ settings: { foreground: c.fg } },
			{
				scope: ["comment", "punctuation.definition.comment"],
				settings: { foreground: c.comment, fontStyle: "italic" },
			},
			// Keywords: ink. docs/styles.css lifts spans of exactly this color to
			// weight 500, so `ink` is reserved for keywords and shell commands;
			// every other token takes `call`, `fg`, or a demoted step. Never bold.
			{
				scope: [
					"keyword",
					"storage",
					"storage.type",
					"keyword.control",
					"keyword.operator.new",
					"keyword.operator.expression",
					"keyword.control.import",
					"keyword.control.export",
					"keyword.control.from",
					"keyword.control.as",
				],
				settings: { foreground: c.ink },
			},
			// Literals: the one place gold appears in code.
			{
				scope: [
					"string",
					"string.quoted",
					"string.template",
					"punctuation.definition.string",
					"constant.numeric",
					"storage.type.numeric.bigint",
				],
				settings: { foreground: c.gold },
			},
			// true / false / null / undefined are literals too.
			{
				scope: ["constant.language", "constant.language.boolean"],
				settings: { foreground: c.gold },
			},
			{
				scope: ["variable.language.this"],
				settings: { foreground: c.fg },
			},
			// Calls: one ink step above identifiers, no weight change.
			{
				scope: [
					"entity.name.function",
					"support.function",
					"meta.function-call",
				],
				settings: { foreground: c.call },
			},
			// Shell builtins and command names read as the "keyword" of a shell line.
			{
				scope: [
					"support.function.builtin",
					"entity.name.command",
					"entity.name.command.shell",
					"entity.name.function.call.shell",
				],
				settings: { foreground: c.ink },
			},
			{
				scope: [
					"variable.other.special",
					"variable.other.normal",
					"punctuation.definition.variable",
				],
				settings: { foreground: c.call },
			},
			{
				scope: ["keyword.operator.pipe", "keyword.operator.redirect"],
				settings: { foreground: c.op },
			},
			{
				scope: [
					"variable.parameter.option",
					"punctuation.definition.parameter",
					"constant.other.option",
				],
				settings: { foreground: c.key },
			},
			// Shell quoted arguments are literals: gold, same as any string.
			{
				scope: ["string.quoted.double.shell", "string.quoted.single.shell"],
				settings: { foreground: c.gold },
			},
			{
				scope: [
					"entity.name.type",
					"entity.name.class",
					"support.type",
					"support.class",
				],
				settings: { foreground: c.type },
			},
			{
				scope: ["variable", "variable.other", "variable.parameter"],
				settings: { foreground: c.fg },
			},
			{
				scope: [
					"variable.other.property",
					"variable.other.object.property",
					"meta.object-literal.key",
					"support.type.property-name",
				],
				settings: { foreground: c.key },
			},
			{
				scope: [
					"keyword.operator",
					"keyword.operator.assignment",
					"keyword.operator.arithmetic",
					"keyword.operator.comparison",
					"keyword.operator.logical",
				],
				settings: { foreground: c.op },
			},
			{
				scope: [
					"punctuation",
					"meta.brace",
					"punctuation.separator",
					"punctuation.terminator",
				],
				settings: { foreground: c.op },
			},
			{
				scope: ["punctuation.definition.template-expression"],
				settings: { foreground: c.call },
			},
			{
				scope: ["entity.name.tag", "punctuation.definition.tag"],
				settings: { foreground: c.type },
			},
			{
				scope: ["entity.other.attribute-name"],
				settings: { foreground: c.key },
			},
			{
				scope: ["string.regexp"],
				settings: { foreground: c.gold },
			},
			{
				scope: ["meta.decorator", "punctuation.decorator"],
				settings: { foreground: c.call },
			},
			// Markdown
			{
				scope: ["markup.inline.raw", "markup.raw"],
				settings: { foreground: c.call },
			},
			{
				scope: ["punctuation.definition.list.begin.markdown"],
				settings: { foreground: c.op },
			},
			{
				scope: ["markup.heading", "entity.name.section"],
				settings: { foreground: c.ink },
			},
			{ scope: ["markup.bold"], settings: { fontStyle: "bold" } },
			{ scope: ["markup.italic"], settings: { fontStyle: "italic" } },
			// JSON: keys stay muted, values are literals and take gold.
			{
				scope: [
					"support.type.property-name.json",
					"meta.structure.dictionary.key.json string",
					"meta.structure.dictionary.key.json punctuation.definition.string",
				],
				settings: { foreground: c.key },
			},
			{
				scope: [
					"meta.structure.dictionary.value.json string.quoted.double.json",
					"meta.structure.array.json string.quoted.double.json",
					"meta.structure.dictionary.value.json punctuation.definition.string",
					"meta.structure.array.json punctuation.definition.string",
					"meta.structure.dictionary.value.json constant.numeric",
					"meta.structure.array.json constant.numeric",
					"meta.structure.dictionary.value.json constant.language",
					"meta.structure.array.json constant.language",
				],
				settings: { foreground: c.gold },
			},
		],
	};
}

export const stacksGold = build("stacks-gold", "light", light);
export const stacksGoldDark = build("stacks-gold-dark", "dark", dark);
