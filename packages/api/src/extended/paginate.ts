import { ValidationError } from "@secondlayer/shared/errors";

/** Hiro v1 block/tx list default page size. */
export const EXTENDED_DEFAULT_LIMIT = 20;
/** Hiro v1 block/tx list hard cap — over → 400, not silent clamp. */
export const EXTENDED_MAX_LIMIT = 30;

export type ExtendedPageQuery = {
	limit: number;
	offset: number;
};

/**
 * Parse limit/offset for `/extended` lists. Rejects cursor/from_cursor —
 * this surface is offset-paginated, not the Index cursor envelope.
 */
export function parseExtendedPageQuery(
	query: Record<string, string | undefined>,
): ExtendedPageQuery {
	if (query.cursor !== undefined) {
		throw new ValidationError("cursor is not supported; use limit and offset");
	}
	if (query.from_cursor !== undefined) {
		throw new ValidationError(
			"from_cursor is not supported; use limit and offset",
		);
	}

	const limit = parseBoundInteger(
		query.limit,
		"limit",
		EXTENDED_DEFAULT_LIMIT,
		1,
		EXTENDED_MAX_LIMIT,
	);
	const offset = parseBoundInteger(query.offset, "offset", 0, 0, undefined);

	return { limit, offset };
}

function parseBoundInteger(
	raw: string | undefined,
	name: string,
	fallback: number,
	min: number,
	max: number | undefined,
): number {
	if (raw === undefined || raw === "") return fallback;
	if (!/^(0|[1-9]\d*)$/.test(raw)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	const n = Number(raw);
	if (!Number.isSafeInteger(n)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	if (n < min) {
		throw new ValidationError(
			max === undefined
				? `${name} must be >= ${min}`
				: `${name} must be between ${min} and ${max}`,
		);
	}
	if (max !== undefined && n > max) {
		throw new ValidationError(`${name} must be between ${min} and ${max}`);
	}
	return n;
}
