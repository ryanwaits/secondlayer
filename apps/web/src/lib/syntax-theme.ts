import type { ThemeRegistrationRaw } from "shiki";

/**
 * Custom monotone syntax theme with sparing purple accents.
 *
 * Palette:
 *   bg        #f8f8f8
 *   fg        #3a3a3a
 *   gray-1    #999999   (comments, punctuation)
 *   gray-2    #666666   (operators, misc)
 *   gray-3    #444444   (properties, attributes)
 *   dark      #1a1a1a   (strings, function names)
 *   purple    #6344F5   (keywords, storage — used sparingly)
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
  ],
};
