import { z } from "zod/v4";

export const AddressProps = z.object({
	value: z.string().describe("Stacks principal (SP…/SM…/ST…)"),
	bns: z.string().nullable().optional().describe("Optional BNS override"),
	truncate: z.boolean().optional().default(true),
});

export type AddressPropsType = z.infer<typeof AddressProps>;

function truncatePrincipal(value: string): string {
	if (value.length <= 14) return value;
	return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function Address(props: AddressPropsType) {
	const display =
		props.bns ??
		(props.truncate ? truncatePrincipal(props.value) : props.value);
	return (
		<span className="font-mono text-sm" title={props.value}>
			{display}
		</span>
	);
}

export const AddressComponent = {
	props: AddressProps,
	render: Address,
} as const;
