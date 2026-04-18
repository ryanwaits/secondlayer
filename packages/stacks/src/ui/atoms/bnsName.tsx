import { z } from "zod/v4";

export const BnsNameProps = z.object({
	name: z.string(),
	namespace: z.string(),
	expiresAt: z.string().nullable().optional().describe("ISO-8601 timestamp"),
});

export type BnsNamePropsType = z.infer<typeof BnsNameProps>;

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
