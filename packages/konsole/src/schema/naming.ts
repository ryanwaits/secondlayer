import pluralize from "pluralize";

export function tableToModelName(tableName: string): string {
  const singular = pluralize.singular(tableName);
  return singular
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}
