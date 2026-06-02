/** Coerce a nullable pg numeric (driver may return string for bigint) to number. */
export function nullableInt(value: string | number | null): number | null {
	return value === null || value === undefined ? null : Number(value);
}

/** Normalize a TIMESTAMPTZ column (Date from the driver, or ISO string) to ISO-8601. */
export function blockTimeToIso(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}
