/**
 * Walks an openpkg spec from a client class down to its public methods.
 *
 * openpkg describes a client three different ways depending on how the
 * author wrote it: class `members` (with visibility), `schema.properties` on
 * a type, and inline objects nested inside either. Callable resources (an
 * interface with a call signature *and* methods, e.g. `index.ftTransfers(...)`
 * plus `index.ftTransfers.list(...)`) show up as a function property whose
 * `x-ts-type` names the interface. This reads all of them into one flat list.
 */
import type { Schema, Signature, Tag } from "./render";

export type Member = {
	name: string;
	kind: string;
	description?: string;
	schema?: Schema;
	signatures?: Signature[];
	tags?: Tag[];
	flags?: Record<string, unknown>;
	visibility?: string;
};

export type Entry = {
	id?: string;
	name: string;
	kind: string;
	description?: string;
	tags?: Tag[];
	source?: { file: string; line: number };
	members?: Member[];
	signatures?: Signature[];
	schema?: Schema;
	extends?: string;
};

export type Spec = {
	meta: { name: string; version: string };
	exports: Entry[];
	types: Entry[];
};

export type RawMethod = {
	/** Path under the surface root, e.g. `events.consume`. Empty for the root itself. */
	segments: string[];
	description: string;
	tags: Tag[];
	signatures: Signature[];
	/** Export that declares the container this method was read from. */
	owner: Entry | undefined;
	/** Segments after `owner`'s own container, for locating the declaration. */
	ownerPath: string[];
};

export type Unresolved = { path: string; reason: string };

type Slot = {
	name: string;
	call: boolean;
	description?: string;
	tags?: Tag[];
	schema?: Schema;
	signatures?: Signature[];
	jsonPath: string;
};

type Container = { slots: Slot[]; owner: Entry | undefined };

const BARE_NAME = /^[A-Za-z_$][\w$]*$/;
const MAX_DEPTH = 8;

export function refTarget(ref: string): string {
	return ref.split("/").pop() ?? ref;
}

export function isPublicName(name: string): boolean {
	return !name.startsWith("_") && !name.startsWith("#");
}

export class Walker {
	private readonly exports = new Map<string, Entry>();
	private readonly types = new Map<string, Entry>();
	readonly unresolved: Unresolved[] = [];

	constructor(spec: Spec) {
		for (const e of spec.exports) this.exports.set(e.name, e);
		for (const t of spec.types) this.types.set(t.name, t);
	}

	entry(name: string): Entry | undefined {
		return this.exports.get(name);
	}

	/** The expanded definition of a named type, exported or not. */
	typeEntry(name: string): Entry | undefined {
		return this.types.get(name);
	}

	/** Every method reachable from `root`'s public members, optionally limited. */
	walkClient(
		root: Entry,
		select: { member?: string; only?: string[] },
	): RawMethod[] {
		const container = this.fromEntry(root);
		const out: RawMethod[] = [];
		const slots = container.slots.filter((s) => {
			if (select.member) return s.name === select.member;
			return select.only?.includes(s.name) ?? false;
		});
		if (select.member) {
			const [slot] = slots;
			if (!slot) return [];
			this.visitSlot(slot, [], container.owner, [], out, 0, true);
			return out;
		}
		for (const slot of slots) {
			this.visitSlot(slot, [], container.owner, [], out, 0, false);
		}
		return out;
	}

	private fromEntry(entry: Entry): Container {
		const slots: Slot[] = [];
		for (const m of entry.members ?? []) {
			if (m.visibility && m.visibility !== "public") continue;
			if (m.flags?.static) continue;
			const call = m.kind === "call-signature";
			if (!call && !isPublicName(m.name)) continue;
			slots.push({
				name: m.name,
				call,
				description: m.description,
				tags: m.tags,
				schema: m.schema,
				signatures: m.signatures,
				jsonPath: `${entry.name}.members.${m.name}`,
			});
		}
		return { slots, owner: entry };
	}

	private fromSchema(
		schema: Schema,
		jsonPath: string,
		owner: Entry | undefined,
	): Container {
		const slots: Slot[] = [];
		for (const [name, value] of Object.entries(schema.properties ?? {})) {
			if (!isPublicName(name)) continue;
			slots.push({
				name,
				call: false,
				description: value.description,
				schema: value,
				signatures: value["x-ts-signatures"],
				jsonPath: `${jsonPath}.properties.${name}`,
			});
		}
		const calls = schema["x-ts-signatures"];
		if (calls?.length) {
			slots.push({
				name: "()",
				call: true,
				schema,
				signatures: calls,
				jsonPath: `${jsonPath}.x-ts-signatures`,
			});
		}
		return { slots, owner };
	}

	private byName(name: string, seen: Set<string>): Container | null {
		if (seen.has(name)) return null;
		seen.add(name);
		const exported = this.exports.get(name);
		if (exported?.members?.length) return this.fromEntry(exported);
		const type = this.types.get(name);
		if (type?.schema) {
			return this.resolve(type.schema, `types.${name}.schema`, exported, seen);
		}
		return null;
	}

	/** A schema's members, following `$ref`, single-arm `allOf` and bare-name `x-ts-type`. */
	private resolve(
		schema: Schema,
		jsonPath: string,
		owner: Entry | undefined,
		seen: Set<string> = new Set(),
	): Container | null {
		if (schema.$ref) return this.byName(refTarget(schema.$ref), seen);
		if (schema.allOf?.length === 1 && schema.allOf[0]) {
			return this.resolve(schema.allOf[0], `${jsonPath}.allOf.0`, owner, seen);
		}
		const tsType = schema["x-ts-type"];
		if (
			schema["x-ts-function"] &&
			tsType &&
			BARE_NAME.test(tsType) &&
			this.exports.get(tsType)?.members?.length
		) {
			return this.byName(tsType, seen);
		}
		if (Object.keys(schema.properties ?? {}).length) {
			return this.fromSchema(schema, jsonPath, owner);
		}
		return null;
	}

	private visitSlot(
		slot: Slot,
		prefix: string[],
		owner: Entry | undefined,
		ownerPath: string[],
		out: RawMethod[],
		depth: number,
		isRoot: boolean,
	): void {
		if (depth > MAX_DEPTH) {
			this.unresolved.push({ path: slot.jsonPath, reason: "nesting too deep" });
			return;
		}
		const here = isRoot ? prefix : [...prefix, slot.name];
		const hereOwnerPath = isRoot ? ownerPath : [...ownerPath, slot.name];
		const container = slot.schema
			? this.resolve(slot.schema, slot.jsonPath, owner)
			: null;
		// Resolving a named type moves the declaring owner to that type.
		const childOwner =
			container && container.owner !== owner ? container.owner : owner;
		const childOwnerPath =
			container && container.owner !== owner ? [] : hereOwnerPath;

		let signatures = slot.signatures;
		const callSlots = container?.slots.filter((s) => s.call) ?? [];
		if (callSlots.length) {
			signatures = callSlots.flatMap((s) => s.signatures ?? []);
		}

		if (signatures?.length) {
			out.push({
				segments: here,
				description: slot.description ?? "",
				tags: slot.tags ?? [],
				signatures,
				owner,
				ownerPath: hereOwnerPath,
			});
		} else if (slot.schema?.["x-ts-function"]) {
			this.unresolved.push({
				path: slot.jsonPath,
				reason: "function property without signatures",
			});
			return;
		}

		if (!container) return;
		for (const child of container.slots) {
			if (child.call) continue;
			this.visitSlot(
				child,
				here,
				childOwner,
				childOwnerPath,
				out,
				depth + 1,
				false,
			);
		}
	}
}
