import { TokenProps, type TokenPropsType } from "./token.schema.ts";

export { TokenProps, type TokenPropsType };

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
