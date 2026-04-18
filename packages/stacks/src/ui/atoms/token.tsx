import { z } from "zod/v4";

export const TokenProps = z.object({
	symbol: z.string(),
	contract: z
		.string()
		.nullable()
		.optional()
		.describe("SIP-010 contract id (for non-STX tokens)"),
	decimals: z.number().int().min(0).max(18).default(6),
});

export type TokenPropsType = z.infer<typeof TokenProps>;

export function Token(props: TokenPropsType) {
	return (
		<span className="font-mono text-sm" title={props.contract ?? undefined}>
			<span className="font-medium">{props.symbol}</span>
		</span>
	);
}

export const TokenComponent = {
	props: TokenProps,
	render: Token,
} as const;
