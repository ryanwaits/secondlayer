import { NftAssetProps, type NftAssetPropsType } from "./nftAsset.schema.ts";

export { NftAssetProps, type NftAssetPropsType };

export function NftAsset(props: NftAssetPropsType) {
	const [, assetName] = props.assetIdentifier.split("::", 2);
	const displayName = props.name ?? `${assetName ?? "NFT"} #${props.tokenId}`;
	return (
		<span className="inline-flex items-center gap-2">
			{props.imageUrl && (
				<img
					src={props.imageUrl}
					alt={displayName}
					className="h-5 w-5 rounded"
					loading="lazy"
				/>
			)}
			<span className="font-mono text-sm">{displayName}</span>
		</span>
	);
}

export const NftAssetComponent = {
	props: NftAssetProps,
	render: NftAsset,
} as const;
