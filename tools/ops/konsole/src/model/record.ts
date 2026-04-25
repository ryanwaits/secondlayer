import type { Kysely } from "kysely";
import type { AssociationDef } from "../schema/associations.ts";
import { tableToModelName } from "../schema/naming.ts";
import type { ModelRegistry, Row } from "./types.ts";

export class Record {
	private _db: Kysely<any>;
	private _table: string;
	private _primaryKey: string;
	private _registry: ModelRegistry;
	private _attrs: Row;
	private _persisted: boolean;

	[key: string]: unknown;

	constructor(
		db: Kysely<any>,
		table: string,
		primaryKey: string,
		_columns: string[],
		associations: AssociationDef[],
		registry: ModelRegistry,
		attrs: Row,
	) {
		this._db = db;
		this._table = table;
		this._primaryKey = primaryKey;
		this._registry = registry;
		this._attrs = { ...attrs };
		this._persisted = attrs[primaryKey] !== undefined;

		// Define attribute getters/setters
		for (const k of Object.keys(attrs)) {
			if (!(k in this)) {
				Object.defineProperty(this, k, {
					get: () => this._attrs[k],
					set: (val) => {
						this._attrs[k] = val;
					},
					enumerable: true,
					configurable: true,
				});
			}
		}

		// Define association getters
		for (const assoc of associations) {
			if (assoc.name in this) continue;
			Object.defineProperty(this, assoc.name, {
				get: () => this._resolveAssociation(assoc),
				enumerable: false,
				configurable: true,
			});
		}
	}

	private _resolveAssociation(assoc: AssociationDef): unknown {
		const targetModel = this._registry[tableToModelName(assoc.toTable)];
		if (!targetModel) return null;

		switch (assoc.type) {
			case "belongs_to": {
				const fkValue = this._attrs[assoc.foreignKey];
				if (fkValue === null || fkValue === undefined)
					return Promise.resolve(null);
				return targetModel.find(fkValue as string | number);
			}
			case "has_many": {
				return targetModel.where({
					[assoc.foreignKey]: this._attrs[this._primaryKey],
				});
			}
			case "has_one": {
				return targetModel.where({
					[assoc.foreignKey]: this._attrs[this._primaryKey],
				}).first;
			}
			case "has_many_through": {
				const myId = this._attrs[this._primaryKey];
				const joinModel = this._registry[tableToModelName(assoc.through!)];
				if (!joinModel) return targetModel.where({ id: null });
				return {
					then: async (resolve: any, reject?: any) => {
						try {
							const joinRows = await joinModel.where({
								[assoc.foreignKey]: myId,
							});
							const targetPk = targetModel._primaryKey;
							const otherFkCol = joinRows[0]
								? Object.keys(
										(joinRows[0] as any).attributes || joinRows[0],
									).find(
										(k: string) => k !== assoc.foreignKey && k.endsWith("_id"),
									)
								: null;
							if (!otherFkCol || joinRows.length === 0) return resolve([]);
							const ids = joinRows.map(
								(r: any) => r.attributes?.[otherFkCol] ?? r[otherFkCol],
							);
							const result = await targetModel.where({ [targetPk]: ids });
							resolve(result);
						} catch (e) {
							if (reject) reject(e);
							else throw e;
						}
					},
					[Symbol.for("nodejs.util.inspect.custom")]() {
						return `<through :${assoc.through}>`;
					},
				};
			}
		}
	}

	get attributes(): Row {
		return { ...this._attrs };
	}

	get isPersisted(): boolean {
		return this._persisted;
	}

	async update(attrs: Row): Promise<Record> {
		const pk = this._attrs[this._primaryKey];
		if (!pk)
			throw new Error(`Cannot update a record without ${this._primaryKey}`);
		await this._db
			.updateTable(this._table)
			.set(attrs as any)
			.where(this._primaryKey as any, "=", pk)
			.execute();

		Object.assign(this._attrs, attrs);
		for (const k of Object.keys(attrs)) {
			if (!Object.getOwnPropertyDescriptor(this, k)?.get) {
				Object.defineProperty(this, k, {
					get: () => this._attrs[k],
					set: (val) => {
						this._attrs[k] = val;
					},
					enumerable: true,
					configurable: true,
				});
			}
		}
		return this;
	}

	async destroy(): Promise<boolean> {
		const pk = this._attrs[this._primaryKey];
		if (!pk)
			throw new Error(`Cannot destroy a record without ${this._primaryKey}`);
		await this._db
			.deleteFrom(this._table)
			.where(this._primaryKey as any, "=", pk)
			.execute();
		this._persisted = false;
		return true;
	}

	async reload(): Promise<Record> {
		const pk = this._attrs[this._primaryKey];
		if (!pk)
			throw new Error(`Cannot reload a record without ${this._primaryKey}`);
		const row = await this._db
			.selectFrom(this._table)
			.selectAll()
			.where(this._primaryKey as any, "=", pk)
			.executeTakeFirst();
		if (!row) throw new Error(`Record not found: ${this._table}#${pk}`);
		this._attrs = { ...(row as Row) };
		return this;
	}

	[Symbol.for("nodejs.util.inspect.custom")]() {
		return this._attrs;
	}

	toJSON(): Row {
		return this._attrs;
	}
}
