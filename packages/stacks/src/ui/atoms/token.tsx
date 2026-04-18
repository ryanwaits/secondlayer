import type { ReactElement } from "react";
import type { StacksAtom } from "../atom-types.ts";
import { TokenProps, type TokenPropsType } from "./token.schema.ts";

export { TokenProps, type TokenPropsType };

export function Token(props: TokenPropsType): ReactElement {
	return (
		<span className="font-mono text-sm" title={props.contract ?? undefined}>
			<span className="font-medium">{props.symbol}</span>
		</span>
	);
}

export const TokenComponent: StacksAtom = {
	props: TokenProps,
	render: Token,
};
