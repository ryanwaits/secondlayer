import type { ThemeRegistrationRaw } from "shiki";

export const monotonePurple: ThemeRegistrationRaw = {
	name: "monotone-purple",
	type: "light",
	colors: {
		"editor.background": "#ffffff",
		"editor.foreground": "#111111",
		"editorLineNumber.foreground": "#c8c8c5",
		"editor.selectionBackground": "#e5e5e2",
	},
	settings: [
		// Base
		{
			settings: {
				foreground: "#111111",
			},
		},
		// Comments
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: {
				foreground: "#5e5e5e",
				fontStyle: "italic",
			},
		},
		// Keywords & storage (accent)
		{
			scope: [
				"keyword",
				"storage",
				"storage.type",
				"keyword.control",
				"keyword.operator.new",
				"keyword.operator.expression",
			],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Import/export/from
		{
			scope: [
				"keyword.control.import",
				"keyword.control.export",
				"keyword.control.from",
				"keyword.control.as",
			],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Strings
		{
			scope: [
				"string",
				"string.quoted",
				"string.template",
				"punctuation.definition.string",
			],
			settings: {
				foreground: "#a37800",
			},
		},
		// Numbers
		{
			scope: ["constant.numeric"],
			settings: {
				foreground: "#a37800",
			},
		},
		// Constants & booleans
		{
			scope: [
				"constant.language",
				"constant.language.boolean",
				"variable.language.this",
			],
			settings: {
				foreground: "#a37800",
			},
		},
		// Function names / calls
		{
			scope: ["entity.name.function", "support.function", "meta.function-call"],
			settings: {
				foreground: "#111111",
			},
		},
		// Shell builtins (curl, echo, export)
		{
			scope: ["support.function.builtin"],
			settings: {
				foreground: "#a37800",
				fontStyle: "bold",
			},
		},
		// Shell variables ($FOO, ${BAR})
		{
			scope: [
				"variable.other.special",
				"variable.other.normal",
				"punctuation.definition.variable",
			],
			settings: {
				foreground: "#a37800",
			},
		},
		// Pipes and redirects
		{
			scope: ["keyword.operator.pipe", "keyword.operator.redirect"],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Command-line flags (-H, --flag)
		{
			scope: ["variable.parameter.option", "punctuation.definition.parameter"],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Shell — command name (curl, git, …) pops accent + bold
		{
			scope: [
				"entity.name.command",
				"entity.name.command.shell",
				"entity.name.function.call.shell",
			],
			settings: {
				foreground: "#a37800",
				fontStyle: "bold",
			},
		},
		// Shell — option flags (-H, --flag) via constant.other.option
		{
			scope: ["constant.other.option"],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Shell — quoted-string arguments stay neutral but distinct from command
		{
			scope: ["string.quoted.double.shell", "string.quoted.single.shell"],
			settings: {
				foreground: "#a37800",
			},
		},
		// Types / classes
		{
			scope: [
				"entity.name.type",
				"entity.name.class",
				"support.type",
				"support.class",
			],
			settings: {
				foreground: "#111111",
			},
		},
		// Variables
		{
			scope: ["variable", "variable.other", "variable.parameter"],
			settings: {
				foreground: "#111111",
			},
		},
		// Properties / object keys
		{
			scope: [
				"variable.other.property",
				"variable.other.object.property",
				"meta.object-literal.key",
				"support.type.property-name",
			],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Operators & punctuation
		{
			scope: [
				"keyword.operator",
				"keyword.operator.assignment",
				"keyword.operator.arithmetic",
				"keyword.operator.comparison",
				"keyword.operator.logical",
			],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Punctuation (braces, brackets, parens, commas, semicolons)
		{
			scope: [
				"punctuation",
				"meta.brace",
				"punctuation.separator",
				"punctuation.terminator",
			],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Template literal expressions
		{
			scope: ["punctuation.definition.template-expression"],
			settings: {
				foreground: "#111111",
			},
		},
		// Tags (JSX/HTML)
		{
			scope: ["entity.name.tag", "punctuation.definition.tag"],
			settings: {
				foreground: "#111111",
			},
		},
		// Attributes
		{
			scope: ["entity.other.attribute-name"],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Regex
		{
			scope: ["string.regexp"],
			settings: {
				foreground: "#a37800",
			},
		},
		// Decorators
		{
			scope: ["meta.decorator", "punctuation.decorator"],
			settings: {
				foreground: "#a37800",
			},
		},
		// Markdown — inline code
		{
			scope: ["markup.inline.raw", "markup.raw"],
			settings: {
				foreground: "#a37800",
			},
		},
		// Markdown — list markers
		{
			scope: ["punctuation.definition.list.begin.markdown"],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// Markdown — headings
		{
			scope: ["markup.heading", "entity.name.section"],
			settings: {
				foreground: "#111111",
				fontStyle: "bold",
			},
		},
		// Markdown — bold/italic
		{
			scope: ["markup.bold"],
			settings: {
				fontStyle: "bold",
			},
		},
		{
			scope: ["markup.italic"],
			settings: {
				fontStyle: "italic",
			},
		},
		// JSON — object keys stay muted (matches property-key style above).
		// Listed after the generic `string` rule so it wins for key tokens.
		{
			scope: [
				"support.type.property-name.json",
				"meta.structure.dictionary.key.json string",
			],
			settings: {
				foreground: "#5e5e5e",
			},
		},
		// JSON — string values pop accent (the LiveKit-style payload view).
		// Scoped under value/array ancestors so it never colors keys; the explicit
		// punctuation descendants color the surrounding quotes accent too.
		{
			scope: [
				"meta.structure.dictionary.value.json string.quoted.double.json",
				"meta.structure.array.json string.quoted.double.json",
				"meta.structure.dictionary.value.json punctuation.definition.string",
				"meta.structure.array.json punctuation.definition.string",
			],
			settings: {
				foreground: "#a37800",
			},
		},
		// JSON — numbers, booleans, and null in values pop accent too.
		{
			scope: [
				"meta.structure.dictionary.value.json constant.numeric",
				"meta.structure.array.json constant.numeric",
				"meta.structure.dictionary.value.json constant.language",
				"meta.structure.array.json constant.language",
			],
			settings: {
				foreground: "#a37800",
			},
		},
	],
};

export const monotonePurpleDark: ThemeRegistrationRaw = {
	name: "monotone-purple-dark",
	type: "dark",
	colors: {
		"editor.background": "#252420",
		"editor.foreground": "#e3e0d9",
		"editorLineNumber.foreground": "#5a5750",
		"editor.selectionBackground": "#2a2c31",
	},
	settings: [
		{ settings: { foreground: "#e3e0d9" } },
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: { foreground: "#b0aca2", fontStyle: "italic" },
		},
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
			settings: { foreground: "#b0aca2", fontStyle: "bold" },
		},
		{
			scope: [
				"string",
				"string.quoted",
				"string.template",
				"punctuation.definition.string",
			],
			settings: { foreground: "#e6c15c" },
		},
		{
			scope: ["constant.numeric"],
			settings: { foreground: "#e6c15c" },
		},
		{
			scope: [
				"constant.language",
				"constant.language.boolean",
				"variable.language.this",
			],
			settings: { foreground: "#e6c15c" },
		},
		{
			scope: ["entity.name.function", "support.function", "meta.function-call"],
			settings: { foreground: "#e3e0d9" },
		},
		// Shell builtins
		{
			scope: ["support.function.builtin"],
			settings: { foreground: "#e6c15c", fontStyle: "bold" },
		},
		// Shell variables
		{
			scope: [
				"variable.other.special",
				"variable.other.normal",
				"punctuation.definition.variable",
			],
			settings: { foreground: "#e6c15c" },
		},
		// Pipes and redirects
		{
			scope: ["keyword.operator.pipe", "keyword.operator.redirect"],
			settings: { foreground: "#b0aca2" },
		},
		// Command-line flags
		{
			scope: ["variable.parameter.option", "punctuation.definition.parameter"],
			settings: { foreground: "#b0aca2" },
		},
		// Shell — command name (curl, git, …) pops accent + bold
		{
			scope: [
				"entity.name.command",
				"entity.name.command.shell",
				"entity.name.function.call.shell",
			],
			settings: { foreground: "#e6c15c", fontStyle: "bold" },
		},
		// Shell — option flags (-H, --flag) via constant.other.option
		{
			scope: ["constant.other.option"],
			settings: { foreground: "#b0aca2" },
		},
		// Shell — quoted-string arguments
		{
			scope: ["string.quoted.double.shell", "string.quoted.single.shell"],
			settings: { foreground: "#e6c15c" },
		},
		{
			scope: [
				"entity.name.type",
				"entity.name.class",
				"support.type",
				"support.class",
			],
			settings: { foreground: "#e3e0d9" },
		},
		{
			scope: ["variable", "variable.other", "variable.parameter"],
			settings: { foreground: "#e3e0d9" },
		},
		{
			scope: [
				"variable.other.property",
				"variable.other.object.property",
				"meta.object-literal.key",
				"support.type.property-name",
			],
			settings: { foreground: "#b0aca2" },
		},
		{
			scope: [
				"keyword.operator",
				"keyword.operator.assignment",
				"keyword.operator.arithmetic",
				"keyword.operator.comparison",
				"keyword.operator.logical",
			],
			settings: { foreground: "#b0aca2" },
		},
		{
			scope: [
				"punctuation",
				"meta.brace",
				"punctuation.separator",
				"punctuation.terminator",
			],
			settings: { foreground: "#b0aca2" },
		},
		{
			scope: ["punctuation.definition.template-expression"],
			settings: { foreground: "#e3e0d9" },
		},
		{
			scope: ["entity.name.tag", "punctuation.definition.tag"],
			settings: { foreground: "#e3e0d9" },
		},
		{
			scope: ["entity.other.attribute-name"],
			settings: { foreground: "#b0aca2" },
		},
		{
			scope: ["string.regexp"],
			settings: { foreground: "#e6c15c" },
		},
		{
			scope: ["meta.decorator", "punctuation.decorator"],
			settings: { foreground: "#e6c15c" },
		},
		// Markdown — inline code
		{
			scope: ["markup.inline.raw", "markup.raw"],
			settings: { foreground: "#e6c15c" },
		},
		// Markdown — list markers
		{
			scope: ["punctuation.definition.list.begin.markdown"],
			settings: { foreground: "#b0aca2" },
		},
		// Markdown — headings
		{
			scope: ["markup.heading", "entity.name.section"],
			settings: { foreground: "#e3e0d9", fontStyle: "bold" },
		},
		// Markdown — bold/italic
		{
			scope: ["markup.bold"],
			settings: { fontStyle: "bold" },
		},
		{
			scope: ["markup.italic"],
			settings: { fontStyle: "italic" },
		},
		// JSON — object keys stay muted
		{
			scope: [
				"support.type.property-name.json",
				"meta.structure.dictionary.key.json string",
			],
			settings: { foreground: "#b0aca2" },
		},
		// JSON — string values pop accent (LiveKit-style payload view)
		{
			scope: [
				"meta.structure.dictionary.value.json string.quoted.double.json",
				"meta.structure.array.json string.quoted.double.json",
				"meta.structure.dictionary.value.json punctuation.definition.string",
				"meta.structure.array.json punctuation.definition.string",
			],
			settings: { foreground: "#e6c15c" },
		},
		// JSON — numbers, booleans, and null in values pop accent too.
		{
			scope: [
				"meta.structure.dictionary.value.json constant.numeric",
				"meta.structure.array.json constant.numeric",
				"meta.structure.dictionary.value.json constant.language",
				"meta.structure.array.json constant.language",
			],
			settings: { foreground: "#e6c15c" },
		},
	],
};
