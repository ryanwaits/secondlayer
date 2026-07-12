// f060 SPIKE — transparent ctx-op counter.
//
// Wraps a REAL SubgraphContext instance in a Proxy that counts calls to each
// read/write method and otherwise delegates unchanged (same object identity,
// same `this` binding, same return values). Used by D1 to report the
// read/write ctx-op ratio per handler invocation without touching
// context.ts. The same technique is reused host-side in the D2 worker PoC.
const READ_METHODS = new Set([
	"findOne",
	"findMany",
	"count",
	"sum",
	"min",
	"max",
	"countDistinct",
	"patchOrInsert", // reads via findOne internally, then queues an upsert
]);
const WRITE_METHODS = new Set([
	"insert",
	"upsert",
	"update",
	"delete",
	"increment",
]);

export interface OpCounts {
	reads: number;
	writes: number;
	byMethod: Record<string, number>;
}

export function wrapWithOpCounter<T extends object>(
	ctx: T,
): { proxy: T; counts: OpCounts } {
	const counts: OpCounts = { reads: 0, writes: 0, byMethod: {} };
	const proxy = new Proxy(ctx, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== "function" || typeof prop !== "string") {
				return value;
			}
			if (!READ_METHODS.has(prop) && !WRITE_METHODS.has(prop)) {
				return value.bind(target);
			}
			return (...args: unknown[]) => {
				counts.byMethod[prop] = (counts.byMethod[prop] ?? 0) + 1;
				if (READ_METHODS.has(prop)) counts.reads++;
				else counts.writes++;
				return value.apply(target, args);
			};
		},
	});
	return { proxy: proxy as T, counts };
}
