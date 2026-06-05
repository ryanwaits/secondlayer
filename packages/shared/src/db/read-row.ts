import type { Selectable } from "kysely";
import type { Database } from "./types.ts";

// postgres.js returns int8/numeric columns as JS strings, but Kysely's
// Selectable<T> types them as `number` from the table interface. A read-row type
// derived straight from Selectable is therefore a lie at runtime. The helpers
// below widen the driver-affected scalars so a read-path row shape matches what
// the driver actually yields (numbers may arrive as strings, Dates as ISO
// strings); null is preserved. Deriving api read rows FROM the producer table
// interface turns an indexer write-schema rename into a read-path compile error
// instead of a silent prod break.

/** Widen a single scalar to its driver-accurate read shape. */
export type NumericAsText<T> = T extends number
	? number | string
	: T extends Date
		? Date | string
		: T;

/**
 * Driver-accurate read-row type: pick selected columns `K` from table `T`'s
 * Selectable shape, then widen each to what postgres.js actually returns.
 * Computed/aliased columns not on the table interface must be intersected on
 * separately at the call site.
 */
export type DbReadRow<
	T extends keyof Database,
	K extends keyof Selectable<Database[T]>,
> = {
	[P in K]: NumericAsText<Selectable<Database[T]>[P]>;
};
