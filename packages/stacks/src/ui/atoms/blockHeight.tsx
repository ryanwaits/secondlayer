import {
	BlockHeightProps,
	type BlockHeightPropsType,
} from "./blockHeight.schema.ts";

export { BlockHeightProps, type BlockHeightPropsType };

function relative(timestamp: string | null | undefined): string | null {
	if (!timestamp) return null;
	const then = new Date(timestamp).getTime();
	if (Number.isNaN(then)) return null;
	const delta = Math.max(0, Date.now() - then);
	const s = Math.floor(delta / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

export function BlockHeight(props: BlockHeightPropsType) {
	const rel = relative(props.timestamp);
	return (
		<span className="font-mono text-sm">
			<span>#{props.height.toLocaleString()}</span>
			{rel && <span className="ml-1 text-muted-foreground">· {rel}</span>}
		</span>
	);
}

export const BlockHeightComponent = {
	props: BlockHeightProps,
	render: BlockHeight,
} as const;
