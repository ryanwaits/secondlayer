import { BnsNameProps, type BnsNamePropsType } from "./bnsName.schema.ts";

export { BnsNameProps, type BnsNamePropsType };

export function BnsName(props: BnsNamePropsType) {
	return (
		<span className="font-mono text-sm">
			<span className="font-medium">{props.name}</span>
			<span className="text-muted-foreground">.{props.namespace}</span>
		</span>
	);
}

export const BnsNameComponent = {
	props: BnsNameProps,
	render: BnsName,
} as const;
