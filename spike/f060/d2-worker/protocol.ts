// f060 SPIKE — message protocol between host.ts and worker-entry.ts.
// Deliberately tiny: the whole point of the boundary is that NOTHING crosses
// it except these shapes — no live objects, no functions, no transaction
// handle, no secrets.
export type HandlerKind = "read-heavy" | "write-only" | "hostile";

export type HostToWorkerMessage =
	| { type: "init"; bundledCode: string; handlerKind: HandlerKind }
	| {
			type: "runBlock";
			blockHeight: number;
			events: Array<{ sender: string; txId: string; poison?: boolean }>;
	  }
	| { type: "runHostile" }
	| {
			type: "readResponse";
			id: number;
			row: Record<string, unknown> | null;
			ms: number;
	  }
	| { type: "shutdown" };

export interface BufferedOp {
	method: "insert" | "upsert" | "increment" | "update" | "delete";
	table: string;
	args: unknown[];
}

export type WorkerToHostMessage =
	| { type: "ready" }
	| {
			type: "readRequest";
			id: number;
			method: "findOne" | "findMany";
			table: string;
			where: Record<string, unknown>;
	  }
	| {
			type: "blockDone";
			blockHeight: number;
			ops: BufferedOp[];
			handlerMs: number;
			readRoundTripMs: number[];
			errors: number;
	  }
	| { type: "hostileReport"; report: Record<string, unknown> }
	| { type: "error"; message: string };
