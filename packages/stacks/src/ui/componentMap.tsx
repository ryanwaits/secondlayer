import type { ReactElement } from "react";
import { Address } from "./atoms/address.tsx";
import { Amount } from "./atoms/amount.tsx";
import { BlockHeight } from "./atoms/blockHeight.tsx";
import { BnsName } from "./atoms/bnsName.tsx";
import { NftAsset } from "./atoms/nftAsset.tsx";
import { Principal } from "./atoms/principal.tsx";
import { Token } from "./atoms/token.tsx";
import { TxStatus } from "./atoms/txStatus.tsx";

type AtomRenderer = (args: { element: { props: unknown } }) => ReactElement;

/**
 * Component map for `createRenderer()` from `@json-render/react`. Bridges
 * json-render's `{ element }` wrapper back to each atom's typed props
 * signature.
 *
 *   import { createRenderer } from "@json-render/react";
 *   import { defineCatalog, schema, atoms, atomComponentMap } from "@secondlayer/stacks/ui";
 *   const catalog = defineCatalog(schema, { components: atoms, actions: {} });
 *   const Renderer = createRenderer(catalog, atomComponentMap);
 *   // <Renderer spec={step.output.spec} />
 */
export const atomComponentMap: Record<string, AtomRenderer> = {
	Address: ({ element }) => (
		<Address {...(element.props as Parameters<typeof Address>[0])} />
	),
	Amount: ({ element }) => (
		<Amount {...(element.props as Parameters<typeof Amount>[0])} />
	),
	BlockHeight: ({ element }) => (
		<BlockHeight {...(element.props as Parameters<typeof BlockHeight>[0])} />
	),
	BnsName: ({ element }) => (
		<BnsName {...(element.props as Parameters<typeof BnsName>[0])} />
	),
	NftAsset: ({ element }) => (
		<NftAsset {...(element.props as Parameters<typeof NftAsset>[0])} />
	),
	Principal: ({ element }) => (
		<Principal {...(element.props as Parameters<typeof Principal>[0])} />
	),
	Token: ({ element }) => (
		<Token {...(element.props as Parameters<typeof Token>[0])} />
	),
	TxStatus: ({ element }) => (
		<TxStatus {...(element.props as Parameters<typeof TxStatus>[0])} />
	),
};
