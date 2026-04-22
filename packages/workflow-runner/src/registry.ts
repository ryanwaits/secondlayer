import type { WorkflowDefinition } from "@secondlayer/workflows";

/**
 * In-memory function registry. Workflow definitions are TS modules compiled
 * into this process — `WorkflowRegistry.register(def)` wires them up at
 * boot. There is no DB-backed "definition" concept in v3: the source of
 * truth is the TS code.
 *
 * Each worker that runs workflows constructs one of these, registers every
 * defined function it knows about, and passes the registry to
 * `startWorkflowRuntime`.
 */
export class WorkflowRegistry {
	// biome-ignore lint/suspicious/noExplicitAny: registry is heterogeneous.
	private readonly map = new Map<string, WorkflowDefinition<any, any>>();

	// biome-ignore lint/suspicious/noExplicitAny: registry is heterogeneous.
	register(def: WorkflowDefinition<any, any>): void {
		if (this.map.has(def.name)) {
			throw new Error(`workflow already registered: ${def.name}`);
		}
		this.map.set(def.name, def);
	}

	// biome-ignore lint/suspicious/noExplicitAny: registry is heterogeneous.
	get(name: string): WorkflowDefinition<any, any> | undefined {
		return this.map.get(name);
	}

	// biome-ignore lint/suspicious/noExplicitAny: registry is heterogeneous.
	getOrThrow(name: string): WorkflowDefinition<any, any> {
		const def = this.map.get(name);
		if (!def) throw new UnknownWorkflowError(name);
		return def;
	}

	names(): string[] {
		return Array.from(this.map.keys());
	}
}

export class UnknownWorkflowError extends Error {
	constructor(name: string) {
		super(`unknown workflow: ${name}`);
		this.name = "UnknownWorkflowError";
	}
}
