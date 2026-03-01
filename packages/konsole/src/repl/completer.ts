import type { SchemaInfo } from "../schema/types.ts";
import type { ModelRegistry } from "../model/types.ts";
import { tableToModelName } from "../schema/naming.ts";

const DOT_COMMANDS = [".tables", ".counts", ".desc", ".schema", ".relations", ".help", ".exit"];

export function createCompleter(
  schema: SchemaInfo,
  models: ModelRegistry,
  ctx: Record<string, unknown>,
) {
  // Build column lookup: ModelName → column names
  const modelColumns = new Map<string, string[]>();
  for (const [tableName, table] of schema.tables) {
    const modelName = tableToModelName(tableName);
    modelColumns.set(modelName, table.columns.map((c) => c.name));
  }

  return function completer(
    line: string,
    callback: (err: null, result: [string[], string]) => void,
  ) {
    const trimmed = line.trim();

    // After `Model.where(` → suggest column names
    const whereMatch = trimmed.match(/^(\w+)\.(where|not|findBy)\(\{?\s*$/);
    if (whereMatch) {
      const cols = modelColumns.get(whereMatch[1]) ?? [];
      const hits = cols.map((c) => `${trimmed}${c}: `);
      callback(null, [hits.length ? hits : [], trimmed]);
      return;
    }

    // General tokens
    const tokens = [
      ...Object.keys(models),
      ...Object.keys(ctx),
      ...DOT_COMMANDS,
    ];
    const unique = [...new Set(tokens)];
    const hits = unique.filter((t) => t.startsWith(trimmed));
    callback(null, [hits.length ? hits : unique, trimmed]);
  };
}
