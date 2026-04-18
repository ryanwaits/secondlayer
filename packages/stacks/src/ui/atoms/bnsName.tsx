import type { ReactElement } from "react";
import type { StacksAtom } from "../atom-types.ts";
import { BnsNameProps, type BnsNamePropsType } from "./bnsName.schema.ts";

export { BnsNameProps, type BnsNamePropsType };

export function BnsName(props: BnsNamePropsType): ReactElement {
	return (
		<span className="font-mono text-sm">
			<span className="font-medium">{props.name}</span>
			<span className="text-muted-foreground">.{props.namespace}</span>
		</span>
	);
}

export const BnsNameComponent: StacksAtom = {
	props: BnsNameProps,
	render: BnsName,
};
