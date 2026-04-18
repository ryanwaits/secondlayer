import { Address } from "./address.tsx";
import { PrincipalProps, type PrincipalPropsType } from "./principal.schema.ts";

export { PrincipalProps, type PrincipalPropsType };

function inferKind(value: string): "standard" | "contract" {
	return value.includes(".") ? "contract" : "standard";
}

export function Principal(props: PrincipalPropsType) {
	const kind = props.kind ?? inferKind(props.value);
	if (kind === "contract") {
		const parts = props.value.split(".", 2);
		const addr = parts[0] ?? props.value;
		const name = parts[1] ?? "";
		return (
			<span className="font-mono text-sm" title={props.value}>
				<Address value={addr} bns={props.bns} truncate />
				<span className="text-muted-foreground">.</span>
				<span className="text-foreground">{name}</span>
			</span>
		);
	}
	return <Address value={props.value} bns={props.bns} truncate />;
}

export const PrincipalComponent = {
	props: PrincipalProps,
	render: Principal,
} as const;
