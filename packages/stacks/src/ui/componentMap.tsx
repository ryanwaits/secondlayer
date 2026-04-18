import { Address } from "./atoms/address.tsx";
import { Amount } from "./atoms/amount.tsx";
import { BlockHeight } from "./atoms/blockHeight.tsx";
import { BnsName } from "./atoms/bnsName.tsx";
import { NftAsset } from "./atoms/nftAsset.tsx";
import { Principal } from "./atoms/principal.tsx";
import { Token } from "./atoms/token.tsx";
import { TxStatus } from "./atoms/txStatus.tsx";

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
export const atomComponentMap = {
	Address: ({ element }: { element: { props: unknown } }) => (
		<Address {...(element.props as Parameters<typeof Address>[0])} />
	),
	Amount: ({ element }: { element: { props: unknown } }) => (
		<Amount {...(element.props as Parameters<typeof Amount>[0])} />
	),
	BlockHeight: ({ element }: { element: { props: unknown } }) => (
		<BlockHeight {...(element.props as Parameters<typeof BlockHeight>[0])} />
	),
	BnsName: ({ element }: { element: { props: unknown } }) => (
		<BnsName {...(element.props as Parameters<typeof BnsName>[0])} />
	),
	NftAsset: ({ element }: { element: { props: unknown } }) => (
		<NftAsset {...(element.props as Parameters<typeof NftAsset>[0])} />
	),
	Principal: ({ element }: { element: { props: unknown } }) => (
		<Principal {...(element.props as Parameters<typeof Principal>[0])} />
	),
	Token: ({ element }: { element: { props: unknown } }) => (
		<Token {...(element.props as Parameters<typeof Token>[0])} />
	),
	TxStatus: ({ element }: { element: { props: unknown } }) => (
		<TxStatus {...(element.props as Parameters<typeof TxStatus>[0])} />
	),
} as const;
