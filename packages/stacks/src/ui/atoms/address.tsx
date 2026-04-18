import type { ReactElement } from "react";
import type { StacksAtom } from "../atom-types.ts";
import { AddressProps, type AddressPropsType } from "./address.schema.ts";

export { AddressProps, type AddressPropsType };

function truncatePrincipal(value: string): string {
	if (value.length <= 14) return value;
	return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function Address(props: AddressPropsType): ReactElement {
	const display =
		props.bns ??
		(props.truncate ? truncatePrincipal(props.value) : props.value);
	return (
		<span className="font-mono text-sm" title={props.value}>
			{display}
		</span>
	);
}

export const AddressComponent: StacksAtom = {
	props: AddressProps,
	render: Address,
};
