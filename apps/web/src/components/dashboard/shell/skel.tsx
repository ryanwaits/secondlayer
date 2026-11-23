export function Skel({
	width,
	height = 14,
	style,
}: {
	width: number | string;
	height?: number;
	style?: React.CSSProperties;
}) {
	return (
		<span
			className="wh-skel"
			aria-hidden="true"
			style={{
				display: "inline-block",
				width,
				height,
				...style,
			}}
		/>
	);
}
