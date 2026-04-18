import { z } from "zod/v4";

export const NftAssetProps = z.object({
	assetIdentifier: z
		.string()
		.describe("Full asset identifier (e.g. SP123.contract::asset-name)"),
	tokenId: z
		.string()
		.describe("Token id (as string to preserve bigint precision)"),
	name: z.string().nullable().optional(),
	imageUrl: z.string().url().nullable().optional(),
});

export type NftAssetPropsType = z.infer<typeof NftAssetProps>;

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
