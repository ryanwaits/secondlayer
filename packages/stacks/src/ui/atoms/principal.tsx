import { z } from "zod/v4";
import { Address } from "./address.tsx";

export const PrincipalProps = z.object({
	value: z.string().describe("Standard or contract principal"),
	bns: z.string().nullable().optional(),
	kind: z.enum(["standard", "contract"]).optional(),
});

export type PrincipalPropsType = z.infer<typeof PrincipalProps>;

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
