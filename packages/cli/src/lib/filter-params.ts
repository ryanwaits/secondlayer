const FILTER_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
const QUERY_ONLY_OPERATORS = ["like"] as const;

type FilterOperator = (typeof FILTER_OPERATORS)[number];
type QueryOnlyOperator = (typeof QUERY_ONLY_OPERATORS)[number];
type AnyOperator = FilterOperator | QueryOnlyOperator;

const ALL_OPERATORS = new Set<string>([
	...FILTER_OPERATORS,
	...QUERY_ONLY_OPERATORS,
]);
const ALL_OPERATOR_LABELS = [...FILTER_OPERATORS, ...QUERY_ONLY_OPERATORS].join(
	", ",
);

interface ParsedFilterArg {
	field: string;
	operator: AnyOperator;
	value: string;
}

function parseFilterArg(input: string): ParsedFilterArg {
	const eqIndex = input.indexOf("=");
	if (eqIndex <= 0) {
		throw new Error(`Invalid filter format: "${input}". Use key=value.`);
	}

	const key = input.slice(0, eqIndex).trim();
	const value = input.slice(eqIndex + 1);
	if (!key)
		throw new Error(`Invalid filter format: "${input}". Use key=value.`);

	const dotIndex = key.lastIndexOf(".");
	if (dotIndex > 0) {
		const field = key.slice(0, dotIndex);
		const operator = key.slice(dotIndex + 1);
		if (!field) throw new Error(`Invalid filter field in "${input}".`);
		if (!ALL_OPERATORS.has(operator)) {
			throw new Error(
				`Invalid filter operator ".${operator}" in "${input}". Supported operators: ${ALL_OPERATOR_LABELS}.`,
			);
		}
		return {
			field,
			operator: operator as AnyOperator,
			value,
		};
	}

	return { field: key, operator: "eq", value };
}

function parseFilterArgs(args?: string[]): ParsedFilterArg[] {
	return (args ?? []).map(parseFilterArg);
}

export function parseQueryFilters(
	args?: string[],
): Record<string, string> | undefined {
	const filters: Record<string, string> = {};
	for (const filter of parseFilterArgs(args)) {
		const key =
			filter.operator === "eq"
				? filter.field
				: `${filter.field}.${filter.operator}`;
		filters[key] = filter.value;
	}
	return Object.keys(filters).length > 0 ? filters : undefined;
}
