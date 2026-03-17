import type { ThemeRegistrationRaw } from "shiki";

/**
 * Custom monotone syntax theme with sparing purple accents.
 *
 * Light palette:
 *   bg        #f8f8f8    fg        #3a3a3a
 *   gray-1    #999999    gray-2    #666666    gray-3    #444444
 *   dark      #1a1a1a    purple    #6344F5
 *
 * Dark palette:
 *   bg        #1c1c1c    fg        #c8c8c8
 *   gray-1    #707070    gray-2    #909090    gray-3    #b0b0b0
 *   light     #e0e0e0    purple    #8b7ff0
 */
export const monotonePurple: ThemeRegistrationRaw = {
  name: "monotone-purple",
  type: "light",
  colors: {
    "editor.background": "#f8f8f8",
    "editor.foreground": "#3a3a3a",
    "editorLineNumber.foreground": "#c0c0c0",
    "editor.selectionBackground": "#e0e0e0",
  },
  settings: [
    // Base
    {
      settings: {
        foreground: "#3a3a3a",
      },
    },
    // Comments
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: {
        foreground: "#aaaaaa",
        fontStyle: "italic",
      },
    },
    // Keywords & storage (the purple accent)
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
        foreground: "#6344F5",
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
        foreground: "#6344F5",
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
        foreground: "#1a1a1a",
      },
    },
    // Numbers
    {
      scope: ["constant.numeric"],
      settings: {
        foreground: "#3a3a3a",
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
        foreground: "#6344F5",
      },
    },
    // Function names / calls
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call",
      ],
      settings: {
        foreground: "#1a1a1a",
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
        foreground: "#444444",
      },
    },
    // Variables
    {
      scope: ["variable", "variable.other", "variable.parameter"],
      settings: {
        foreground: "#3a3a3a",
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
        foreground: "#555555",
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
        foreground: "#888888",
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
        foreground: "#999999",
      },
    },
    // Template literal expressions
    {
      scope: ["punctuation.definition.template-expression"],
      settings: {
        foreground: "#6344F5",
      },
    },
    // Tags (JSX/HTML)
    {
      scope: ["entity.name.tag", "punctuation.definition.tag"],
      settings: {
        foreground: "#444444",
      },
    },
    // Attributes
    {
      scope: ["entity.other.attribute-name"],
      settings: {
        foreground: "#666666",
      },
    },
    // Regex
    {
      scope: ["string.regexp"],
      settings: {
        foreground: "#666666",
      },
    },
    // Decorators
    {
      scope: ["meta.decorator", "punctuation.decorator"],
      settings: {
        foreground: "#6344F5",
      },
    },
    // Markdown — inline code
    {
      scope: ["markup.inline.raw", "markup.raw"],
      settings: {
        foreground: "#6344F5",
      },
    },
    // Markdown — list markers
    {
      scope: ["punctuation.definition.list.begin.markdown"],
      settings: {
        foreground: "#888888",
      },
    },
    // Markdown — headings
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: {
        foreground: "#1a1a1a",
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
  ],
};

export const monotonePurpleDark: ThemeRegistrationRaw = {
  name: "monotone-purple-dark",
  type: "dark",
  colors: {
    "editor.background": "#1c1c1c",
    "editor.foreground": "#c8c8c8",
    "editorLineNumber.foreground": "#555555",
    "editor.selectionBackground": "#333333",
  },
  settings: [
    { settings: { foreground: "#c8c8c8" } },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#666666", fontStyle: "italic" },
    },
    {
      scope: [
        "keyword", "storage", "storage.type", "keyword.control",
        "keyword.operator.new", "keyword.operator.expression",
        "keyword.control.import", "keyword.control.export",
        "keyword.control.from", "keyword.control.as",
      ],
      settings: { foreground: "#8b7ff0" },
    },
    {
      scope: [
        "string", "string.quoted", "string.template",
        "punctuation.definition.string",
      ],
      settings: { foreground: "#e0e0e0" },
    },
    {
      scope: ["constant.numeric"],
      settings: { foreground: "#c8c8c8" },
    },
    {
      scope: [
        "constant.language", "constant.language.boolean",
        "variable.language.this",
      ],
      settings: { foreground: "#8b7ff0" },
    },
    {
      scope: [
        "entity.name.function", "support.function", "meta.function-call",
      ],
      settings: { foreground: "#e0e0e0" },
    },
    {
      scope: [
        "entity.name.type", "entity.name.class",
        "support.type", "support.class",
      ],
      settings: { foreground: "#b0b0b0" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter"],
      settings: { foreground: "#c8c8c8" },
    },
    {
      scope: [
        "variable.other.property", "variable.other.object.property",
        "meta.object-literal.key", "support.type.property-name",
      ],
      settings: { foreground: "#a0a0a0" },
    },
    {
      scope: [
        "keyword.operator", "keyword.operator.assignment",
        "keyword.operator.arithmetic", "keyword.operator.comparison",
        "keyword.operator.logical",
      ],
      settings: { foreground: "#808080" },
    },
    {
      scope: [
        "punctuation", "meta.brace",
        "punctuation.separator", "punctuation.terminator",
      ],
      settings: { foreground: "#707070" },
    },
    {
      scope: ["punctuation.definition.template-expression"],
      settings: { foreground: "#8b7ff0" },
    },
    {
      scope: ["entity.name.tag", "punctuation.definition.tag"],
      settings: { foreground: "#b0b0b0" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#909090" },
    },
    {
      scope: ["string.regexp"],
      settings: { foreground: "#909090" },
    },
    {
      scope: ["meta.decorator", "punctuation.decorator"],
      settings: { foreground: "#8b7ff0" },
    },
    // Markdown — inline code
    {
      scope: ["markup.inline.raw", "markup.raw"],
      settings: { foreground: "#8b7ff0" },
    },
    // Markdown — list markers
    {
      scope: ["punctuation.definition.list.begin.markdown"],
      settings: { foreground: "#707070" },
    },
    // Markdown — headings
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: "#e0e0e0", fontStyle: "bold" },
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
  ],
};
