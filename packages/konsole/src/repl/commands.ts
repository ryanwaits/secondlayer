import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { AssociationMap } from "../schema/associations.ts";
import { tableToModelName } from "../schema/naming.ts";
import type { SchemaInfo } from "../schema/types.ts";
import { cyan, dim, green } from "./colors.ts";
import { printTable } from "./printer.ts";

export function createCommands(
	db: Kysely<any>,
	schema: SchemaInfo,
	associations: AssociationMap,
): Record<string, (arg: string) => Promise<void>> {
	return {
		async tables() {
			for (const name of schema.tables.keys()) {
				console.log(`  ${name}`);
			}
		},

		async counts() {
			const rows: Record<string, unknown>[] = [];
			for (const name of schema.tables.keys()) {
				const { rows: r } = await sql<{ count: string }>`
          SELECT count(*)::text as count FROM ${sql.ref(name)}
        `.execute(db);
				rows.push({ table: name, rows: Number(r[0]?.count ?? 0) });
			}
			printTable(rows);
		},

		async desc(tableName: string) {
			const name = tableName.trim();
			const table = schema.tables.get(name);
			if (!table) {
				console.log(dim(`  Unknown table: "${name}". Use .tables to list.`));
				return;
			}
			printTable(
				table.columns.map((c) => ({
					column: c.name,
					type: c.dataType,
					nullable: c.nullable ? "YES" : "NO",
					pk: c.isPrimaryKey ? "YES" : "",
					default: c.hasDefault ? "yes" : "",
				})),
			);
		},

		async schema() {
			for (const [tableName, table] of schema.tables) {
				const model = tableToModelName(tableName);
				const pk = table.primaryKey;
				const cols = table.columns.map((c) => c.name).join(", ");
				console.log(`  ${cyan(model)} ${dim(`(${tableName})`)}`);
				console.log(dim(`    pk: ${pk} | cols: ${cols}`));

				const assocs = associations[tableName];
				if (assocs?.length) {
					for (const a of assocs) {
						console.log(
							dim(`    ${a.type} :${a.name} → ${a.toTable} (${a.foreignKey})`),
						);
					}
				}
				console.log("");
			}
		},

		async relations(tableName: string) {
			const name = tableName.trim();
			const table = schema.tables.get(name);
			if (!table) {
				console.log(dim(`  Unknown table: "${name}". Use .tables to list.`));
				return;
			}
			const assocs = associations[name] ?? [];
			if (assocs.length === 0) {
				console.log(dim(`  No associations on ${name}`));
				return;
			}
			printTable(
				assocs.map((a) => ({
					type: a.type,
					name: a.name,
					target: a.toTable,
					fk: a.foreignKey,
					...(a.through ? { through: a.through } : {}),
				})),
			);
		},

		async help() {
			console.log(dim("  ActiveRecord-style:"));
			console.log(
				`    ${green("Model")}.all                ${dim("all rows (lazy, chainable)")}`,
			);
			console.log(
				`    ${green("Model")}.find(id)            ${dim("find by primary key")}`,
			);
			console.log(
				`    ${green("Model")}.findBy({ email })   ${dim("find first matching")}`,
			);
			console.log(
				`    ${green("Model")}.where({ plan })     ${dim("chainable query")}`,
			);
			console.log(
				`    ${green("Model")}.first / .last       ${dim("first/last by PK")}`,
			);
			console.log(
				`    ${green("Model")}.count               ${dim("count rows")}`,
			);
			console.log(
				`    ${green("Model")}.pluck("col")        ${dim("array of single column")}`,
			);
			console.log(
				`    ${green("Model")}.create({ ... })     ${dim("INSERT RETURNING")}`,
			);
			console.log(
				`    ${green("record")}.update({ ... })    ${dim("update instance")}`,
			);
			console.log(
				`    ${green("record")}.destroy()          ${dim("delete instance")}`,
			);
			console.log(
				`    ${green("record")}.reload()           ${dim("re-fetch from DB")}`,
			);
			console.log(
				`    ${green("record")}.association        ${dim("follow FK association")}`,
			);
			console.log("");
			console.log(dim("  Raw helpers:"));
			console.log(
				`    ${green("db")}                        ${dim("Kysely instance")}`,
			);
			console.log(
				`    ${green("rawSql")}${dim("(query)")}               ${dim("run raw SQL string")}`,
			);
			console.log(
				`    ${green("sql")}                        ${dim("Kysely sql tag")}`,
			);
			console.log("");
			console.log(dim("  Commands:"));
			console.log(
				`    ${green(".tables")}                    ${dim("list all tables")}`,
			);
			console.log(
				`    ${green(".counts")}                    ${dim("row counts per table")}`,
			);
			console.log(
				`    ${green(".desc")} ${dim("<table>")}               ${dim("describe table columns")}`,
			);
			console.log(
				`    ${green(".schema")}                    ${dim("tables + associations")}`,
			);
			console.log(
				`    ${green(".relations")} ${dim("<table>")}          ${dim("associations for table")}`,
			);
			console.log(
				`    ${green(".help")}                      ${dim("show this help")}`,
			);
			console.log(`    ${green(".exit")}                      ${dim("quit")}`);
		},
	};
}
